"use strict"
// Copyright (C) 2014 OneJS
//
//   Licensed under the Apache License, Version 2.0 (the "License");
//   you may not use this file except in compliance with the License.
//   You may obtain a copy of the License at
//       http://www.apache.org/licenses/LICENSE-2.0
//   Unless required by applicable law or agreed to in writing, software
//   distributed under the License is distributed on an "AS IS" BASIS,
//   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//   See the License for the specific language governing permissions and
//   limitations under the License.

// ONEJS boot up fabric for webbrowser

// toggle fake worker on or off
ONE.fake_worker = true
ONE.ignore_cache = false
ONE.prototype_mode = true
ONE.compress_cache = false
ONE.hammer_time = 50 // its about as bad an idea as the song

ONE.hacklog = function(txt){
	if(document.body)
	document.body.innerHTML += '<span style="color:#fff">'+txt+'</span>&nbsp;'
}

ONE.worker_boot_ = function(host){
	
	function delayRunMessage(msg){
		return function(){
			var dt = Date.now()
			if(typeof msg.proxify_cache == 'object') host.proxify_cache = msg.proxify_cache
			ONE.__modules__[msg.module_name].compiled_function.call(ONE.root)
			ONE.total_run = Date.now() -dt
			setTimeout(host.writeModuleCache, 10)
		}
	}

	host.onmessage = function(event){
		var data = event.data
		if(!Array.isArray(data)) throw new Error('non array message received')
		for(var i = 0, l = data.length; i < l; i++){
			var msg = data[i]
			if(msg._type == 'signal'){ // we have to set a value
				var obj = host.proxy_obj[msg._uid]
				if(!obj) throw new Error('set on nonexistant object ' + msg._uid)
				var value = ONE.proxyDataUnescape(msg.value, host.proxy_obj) || msg.value
				obj[msg.name] = value
			}
			else if(msg._type == 'call'){
				var obj = host.proxy_obj[msg._uid]
				if(!obj) throw new Error('Call on nonexistant object ' + msg._uid)
				if(msg.args) obj[msg.name].apply(obj, msg.args)
				else obj[msg.name].call(obj)
			}
			else if (msg._type == 'return'){
				var sig = host.call_signals[msg.callid]
				if(!sig) throw new Error('Return on nonexistant signal ')
				host.call_free.push(msg.callid)
				host.call_signals[msg.callid] = undefined
				var obj = ONE.proxyDataUnescape(msg.ret, host.proxy_obj)
				if(obj) msg.ret = obj
				sig.end(msg.ret)
			}
			else if(msg._type == 'eval'){ // lets parse and eval a module
				var module = ONE.__modules__[msg.module_name]
				var ast = module.ast
				var dt = Date.now()
				if(!ast){
					return console.log('Module ' + msg.module_name + ' not parsed')
				}
				module.compiled_function = ONE.root.eval(ast, msg.module_name)
				// lets push this on our cache queue
				ONE.compile_cache_queue.push(module)
				var ms = Date.now()-dt
				ONE.total_eval += ms
			}
			else if(msg._type == 'parse'){
				var dt = Date.now()
				var module = ONE.__modules__[msg.module_name] = Object.create(null)
				module.name = msg.module_name
				module.source_code = msg.value
				module.ast = ONE.root.parse('->{' + msg.value + '\n}', msg.module_name)
				var ms = Date.now()-dt
				ONE.total_parse += ms
			}
			else if(msg._type == 'run'){
				if(ONE.import_queue) ONE.import_complete = delayRunMessage(msg)
				else delayRunMessage(msg)()
			}
			else if(msg._type == 'import'){
				ONE.importFetch(msg.url, msg.responseType)
			}
			else if(msg._type == 'eval_cached'){
				var module = ONE.root.deserializeModule(msg.module_name, msg.value)
			}
		}
		host.postProcess()
	}

	// module cache
	host.writeModuleCache = function(){
		console.log('load time ' + (ONE.total_eval + ONE.total_parse + ONE.total_run + ONE.total_proxify+ ONE.total_deserialize + ONE.total_compile) + ' ' +
				'eval: ' + ONE.total_eval + ' parse:'+ONE.total_parse + ' run:'+ONE.total_run + ' proxify:'+ONE.total_proxify + ' total_deserialize:'+ONE.total_deserialize+ ' total_compile:'+ONE.total_compile)
		var queue = ONE.compile_cache_queue
		// lets encode all our modules and send them over to the main thread for caching.
		for(var i = 0;i<queue.length;i++){
			var module = queue[i]
			var blob = ONE.Base.AST.serializeModule(module)
			if(ONE.compress_cache)
				blob = ONE.deflate(blob, {level:6, to:'string'})
			host.sendToHost({_type:'module_cache', key:module.source_code, value:blob})
		}
	}.bind(host)

	host.call_id = 0
	host.call_signals = {}
	host.call_free = []
	// message queueing
	host.msg_queue = []
	host.msg_transfer = []
	host.msg_sigblk = []
	//var id = 1
	host.transferToHost = function(data, name){
		if(data.transferd) return
		data.transfered = 1
		return this.msg_transfer.push(data)
	}

	host.sendToHost = function(msg, sigblk){
		if(sigblk) this.msg_sigblk.push(sigblk, msg)
		this.msg_queue.push(msg)
	}

	// Set immediate
	function _setImmediate(cb){
		return host.immediate_queue.push(cb) + 1
	}
	host.immediate_queue = []
	if(typeof window !== 'undefined') window.setImmediate = _setImmediate
	else if(typeof global !== 'undefined') global.setImmediate = _setImmediate
	else setImmediate = _setImmediate

	// Set interval
	var __setInterval = setInterval
	function _setInterval(cb, time){
		return __setInterval(function(){
			cb()
			host.postProcess()
		}, time)
	}
	if(typeof window !== 'undefined') window.setInterval = _setInterval
	else if(typeof global !== 'undefined') global.setInterval = _setInterval
	else setInterval = _setInterval

	// Set timeout
	var __setTimeout = setTimeout
	function _setTimeout(cb, time){
		return __setTimeout(function(){
			cb()
			host.postProcess()
		}, time)
	}
	if(typeof window !== 'undefined') window.setTimeout = _setTimeout
	else if(typeof global !== 'undefined') global.setTimeout = _setTimeout
	else setTimeout = _setTimeout

	// vector queue, used to auto transfer typed vectors when their length changes
	host.vector_queue = []

	// proxification
	host.proxy_obj = {}
	host.proxify_queue = []
	host.proxify_cache = {}
	host.proxy_uid = 1
	host.proxy_free = []

	// do all the things we need to do post a code execution
	host.postProcess = function(){
		// process proxification
		while(host.proxify_queue.length || host.vector_queue.length || host.msg_queue.length || host.immediate_queue.length){
			if(host.proxify_queue.length){
				var queue = host.proxify_queue
				host.proxify_queue = []
				var dt = Date.now()
				for(var i = 0, l = queue.length; i<l; i++){
					queue[i]._proxify()
				}
				ONE.total_proxify += Date.now() - dt
			}
			// process vector queue
			if(host.vector_queue.length){
				var queue = host.vector_queue
				host.vector_queue = []
				for(var i = 0;i<queue.length;i++){
					var q = queue[i]
					// call the setter to transfer
					q._bind_[q._key_] = q
				}
			}
			// process the message queue
			if(host.msg_sigblk.length){
				var queue = host.msg_sigblk
				for(var i = 0;i<queue.length;i+=2){
					queue[i]['__setvalue_'+queue[i+1].name] = undefined
				}
				host.msg_sigblk = []
			}		
			// first flush what we have
			if(host.msg_queue.length){
				var queue = host.msg_queue
				var transfer = host.msg_transfer
				host.msg_transfer = []
				host.msg_queue = []
				host.postMessage(queue, transfer)
			}
			// execute all setImmediates
			if(host.immediate_queue.length){
				var queue = host.immediate_queue
				host.immediate_queue = []
				for(var i = 0; i<queue.length; i++){
					queue[i]()
				}
			}
		}
	}
	
	ONE.import_queue = 0
	ONE.import_complete

	ONE.importFetch = function(url, responseType){
		ONE.import_queue++
		var req = new XMLHttpRequest()
		var full_url = ONE.origin + '/' + url
		req.open("GET", full_url, true)
		req.responseType = responseType 
		req.onreadystatechange = function(){
			if(req.readyState == 4){
				if(req.status != 200){
				}
				else{
					var mod = ONE.__modules__[url] = {
						name:url,
						instance:req.response || req.responseText
					}
					if(typeof mod.instance == 'object')
						mod.instance.name = url
				}
				if(!--ONE.import_queue && ONE.import_complete){
					ONE.import_complete()
					host.postProcess()
				}
			}
		}
		req.send()
	}

	ONE.compile_cache_queue = []

	// statistics
	ONE.total_eval = 0
	ONE.total_proxify = 0
	ONE.total_parse = 0
	ONE.total_deserialize = 0
	ONE.total_compile = 0 

	ONE.host = host

	ONE.init()
	ONE.init_ast()

	ONE.Base.thisInterval = function(cb, time){
		var pthis = this
		return __setInterval(function(){
			cb.call(pthis)
			host.postProcess()
		}, time)
	}

	ONE.Base.thisTimeout = function(cb, time){
		var pthis = this
		return __setTimeout(function(){
			cb.call(pthis)
			host.postProcess()
		}, time)
	}
	ONE.Base.hideProperties()
	ONE.root = ONE.Base.new()
	ONE.root.__class__ = 'Root'
}

ONE.proxy_ = function(){

	// baseclass for the worker objects
	this.Base.WorkerProxy = this.Base.extend(function(){
		this.__proxy__ = 0
		this.__class__ = 'WorkerProxy'

		// called when someone makes an instance
		this.prestructor = function(){
			if(!ONE.host.proxy_free.length) this.__proxy__ = ONE.host.proxy_uid++
			else this.__proxy__ = ONE.host.proxy_free.pop()
			this.defineProperty('__proxy__', { enumerable:false, configurable:true })
			// store it
			ONE.host.proxy_obj[this.__proxy__] = this

			// queue up our object proxify
			ONE.host.proxify_queue.push(this)
		}
		
		// make sure extend pre and post dont fire on us
		var blockPrePost = this

		// called in .extend to make sure we proxify before being used
		// this is necessary otherwise the getter/setter layer never works
		this._extendPre = function(){
			if(this == blockPrePost) return // make sure our current.extend doesnt trigger us
			if(!ONE.host.proxy_free.length) this.__proxy__ = ONE.host.proxy_uid++
			else this.__proxy__ = ONE.host.proxy_free.pop()
			this.defineProperty('__proxy__', { enumerable:false, configurable:true })
			// store it
			ONE.host.proxy_obj[this.__proxy__] = this
		}

		this._extendPost = function(){
			if(this == blockPrePost) return // make sure our current.extend doesnt trigger us
			this.Base._extendPost.call(this)
			this._proxify()
		}

		// the main property proxy on the worker side
		this._propertyProxy = function(name){
			if(this.__lookupSetter__(name)) return

			var store = '__' + name
			var sigblk = '__setvalue_' + name
			this[store] = this[name]

			if(!this.__lookupSetter__(name)) Object.defineProperty(this, name, {
				get:function(){
					return this[store]
				},
				set:function(v){
					var old = this[store]
					this[store] = v
					var sigmsg = this[sigblk]
					// fastpath to swallow multiple value changes in one execution
					if(sigmsg && sigmsg._type == 'setvalue' && (!v || !v._transfer_)){
						console.log('blocking signal')
						sigmsg.value = v
						return
					}
					if(this.hasOwnProperty('__compilehash__')){
						// if we switch from value to astnode and back we need a recompile
						if(v && v.__proxy__/* || old && old.__proxy__*/){
							return ONE.host.sendToHost({_type:'setref', _uid:this.__proxy__, name:name, value:v.__proxy__})
						}
						var recompile = false
						if(v && v._ast_){
							recompile = true
						}
						else if(old && old._ast_) recompile = true

						if(!recompile){
							var msg = {_type:'setvalue', _uid:this.__proxy__, name:name}
							this[sigmsg] = msg
							if(typeof v !== 'object'){
								msg.value = v
							}
							else if(v._t_){
								if(v._transfer_) msg.value = v._transfer_(ONE.host)
								else msg.value = v
							}
							return ONE.host.sendToHost(msg, this)
						}
						// line us up for reproxification
						if(!this._proxify_flag){
							this._proxify_flag = true
							ONE.host.proxify_queue.push(this)
						}
					}
				}
			})
		}
		
		this._compilePropBinds = function(){
			var hasbinds = false
			var binds = this.proxy_refs
			var init = 'this._initBinds = function(){\n'
			var deinit = 'this._deinitBinds = function(){\n'
			for(var bind in binds){
				hasbinds = true
				var props = binds[bind]
				for(var prop in props){
					init += '\tthis._bindProp(this.'+bind+',"'+prop+'")\n'
					deinit += '\tthis._unbindProp(this.'+bind+',"'+prop+'")\n'
				}
			}
			if(!hasbinds) return ''
			init += '}\n'
			deinit += '}\n'
			// alright. how does this propertybinding crap look like.
			// alright so, we wanna bind to 
			return init+deinit
		}

		// proxify builds the message that spawns and updates proxified objects
		// on the host side.
		this._proxify = function(){
			// create a proxy id
			this._proxify_flag = false
			var proto = Object.getPrototypeOf(this)

			var isupdate = this.hasOwnProperty('__compilehash__')

			// iterate the keys we have
			var comp
			var msg = {_type:'proxify', _proto:proto.__proxy__, _uid:this.__proxy__}
			var transfers = []
			var hash = proto.__compilehash__ || ""

			var keys = Object.keys(this)
			var methods = ""

			for(var i = 0, l = keys.length; i < l; i++){
				var name = keys[i]
				// skip all getters and setters
				if((this.__lookupSetter__(name) || 
				   this.__lookupGetter__(name)) && !this['on_' + name]) continue

				var prop = this[name]
				var ch = name.charCodeAt(0)

				// make sure our property-settered values get forwarded
				if(ch == 95 && name.charCodeAt(1) == 95 && 
					(name.charCodeAt(name.length - 1) != 95 || 
					   name.charCodeAt(name.length - 2) != 95)){
					name = name.slice(2), ch = 0
					if(this['on_' + name]) continue // skip signal storage
				}

				if(ch == 36){ //$
					var base = name.slice(1)
					if(typeof prop == 'function'){ // execute
						if(!comp){
							comp = this.__compiles__ = Object.create(this.__compiles__ || null)	
						}
						hash += base + '='+prop.toString()+'\n'
						comp[base] = prop // store it
					}
					else if(prop._ast_){ // its a remote method
						var js = this.AST.ToJS
						js.new_state()
						js.module = prop.module
						methods += 'this.' + base + ' = ' + js.expand(prop) + '\n'
						for(var k in js.type_methods){
							methods = js.type_methods[k] + '\n'+ methods
						}

						// ok we have to now also add 
						//cache += base + '=' + prop.source + '\n'
					}
				}
				else if(ch != 95 && !this['_dontproxy_'+name]){ // doesnt start with _
					if(this['on_' + name]){ // we haz signal
						if(!msg._sigs) msg._sigs = []
						msg._sigs.push(name)
						msg[name] = this['__' + name].value
					}
					else
					if(prop && typeof prop == 'object'){
						if(prop.__proxy__){
							if(!msg._refs) msg._refs = []
							msg[name] = prop.__proxy__
							msg._refs.push(name)
							this._propertyProxy(name)
						}
						else if(prop._t_){ // only copy typed properties
							this._propertyProxy(name)
							// make a value-forward getter-setter
							// check if we are doing a transferable
							if(prop._transfer_){
								prop._bind_ = this
								prop._key_ = name
								msg[name] = prop._transfer_(ONE.host, name)
							}
							else{
								msg[name] = prop
							}
							//var proto_prop = proto[name]
							//if(proto_prop !== undefined && (!proto_prop._t_ || proto_prop._t_.name != prop._t_.name)){
							//	throw new Error('Error, cannot change type from baseclass property '+name+' my type: ' + prop._t_.name)
							//}
							//else 
							hash += name + '=' + prop._t_.name + prop._t_.slots + '\n'
						}
						else if(prop._ast_){ // we found an expression, include it in our compile cache key
							var locals = prop.locals
							for(var local_name in locals){
								// we have to make sure the right thing goes in
								var local_val = locals[local_name]
								if(local_val && local_val.__proxy__){
									msg[local_name] = local_val.__proxy__
									if(!msg._refs) msg._refs = []
									msg._refs.push(local_name)
								}
								else if(typeof prop != 'object' || (prop && prop._t_)){
									msg[local_name] = local_val
								}
							}
							// Todo: do storing context values here so we can cache compiles
							// make a recompile-triggering getter-setter
							this._propertyProxy(name)
							hash += name + '=' + prop.source + '\n'
						}
					}
					else if(typeof prop != 'function'){
						// make a value-forward getter-setter
						this._propertyProxy(name)
						var proto_prop = proto[name]
						if(proto_prop && proto_prop._ast_) 
							hash += name + '=#\n'
						msg[name] = prop
					}
				}
			}
			this.__compilehash__ = hash
			// we do have to 
			// only compile things if we are an instance
			if(!this.hasOwnProperty('__class__')){
				// lets first check if we actually need to compile by comparing
				// our __compilehash__ with our prototype chain
				// ok so what do we need
				if( hash && ((this.__compilehash__ && hash !== this.__compilehash__) || 
					hash !== proto.__compilehash__ || !proto.__compiled__)){

					this.proxy_refs = Object.create(null)
					// WARNING. we might need more strict rules on compiler cache, but lets try it
					var code = ONE.host.proxify_cache[hash]
					if(code === undefined){
						code = ''
						var comp = this.__compiles__
						for(var name in comp){
							var prop = comp[name]
							code += prop.call(this) + '\n'
						}
						code += this._compilePropBinds()
						ONE.host.proxify_cache[hash] = code
						ONE.host.sendToHost({_type:'proxify_cache', key:hash, value:code})
					}
					//else console.log('code cache hit!')

					// TODO fix compile caching based on hash
					if(code){
						
						// ok we have code. now we check if we can place it higher up the prototype chain
						var last
						while(proto && proto.__compilehash__ == hash){
							//console.log('movin it up on ', this.__proxy__)
							last = proto
							proto = Object.getPrototypeOf(proto)
						}

						if(last){ // lets store it on last
							last.__compiled__ = true
							ONE.host.sendToHost({_type:'proxify', _uid:last.__proxy__,  _code:code})
						}
						else{
							this.__compiled__ = true
							msg._code = code
						}
					}
				}
			}
			else msg.__class__ = 'Host - '+this.__class__
			this.__compilehash__ = hash
			msg._code = msg._code?msg._code + methods:methods
			// ok we first send our object with codehash

			ONE.host.sendToHost(msg)
		}

		// its a call without return expectation
		this.postHost = function(name){
			if(arguments.length > 1){
				ONE.host.sendToHost({_type:"call", name:name, _uid: this.__proxy__, args:Array.prototype.slice.call(arguments,1)})
			}
			else ONE.host.sendToHost({_type:"call", name:name, _uid: this.__proxy__})
		}

		// make an call and return a signal as return value
		this.callHost = function(name){
			// lets create a pending callback hook
			var sig = ONE.Base.Signal.new()
			// fetch a call id
			var myid
			if(ONE.host.call_free.length){
				myid = ONE.host.call_free.pop()
			}
			else{
				myid = ONE.host.call_id++
				if(myid > 1000) console.log("Runaway call ID detected")
			}
			ONE.host.call_signals[myid] = sig
			if(arguments.length > 1){
				ONE.host.sendToHost({_type:"call", name:name, _uid: this.__proxy__, args:Array.prototype.slice.call(arguments,1), callid:myid})
			}
			else ONE.host.sendToHost({_type:"call", name:name, _uid: this.__proxy__, callid:myid})
			return sig
		}

		this.hideProperties(Object.keys(this))
	})

	// the baseclass for the host objects
	this.Base.HostProxy = this.Base.extend(function(){
		
		this.__proxy_module__ = {local_types:{}}
		this.__proxy_cache__ = {}
		this.__class__ = 'HostProxy'
		this._getsetSig = function(name, worker){
			var store = '__' + name
			this[store] = this[name]

			this.defineProperty(name, {
				get:function(){
					return this[store]
				},
				set:function(v){
					this[store] = v
					// lets forward this
					
				}
			})
		}

		this._bindProp = function(obj, prop, worker){

			// what does that look like?
			var bind_store = '_bind_' + prop
			var store = '__' + prop

			if(Array.isArray(obj)){ // we are a late bind
				obj.push(this, null, prop)
				return
			}

			if(obj !== this){
				if(obj[bind_store]){
					obj[bind_store].push(this)
				}
				else{
					obj[bind_store] = [this]
				}
			}

			if(!obj.__lookupSetter__(prop)){
				// store old value
				obj[store] = obj[prop]
				if(typeof obj !='object') throw new Error('not object')
				Object.defineProperty(obj, prop, {
					get:function(){
						return this[store]
					},
					set:function(v){
						var old = this[store]
						if(old !== v){ // only forward on change
							this[store] = v
							var arr = this[bind_store]
							if(arr) for(var i = 0, l = arr.length; i < l; i++){
								var node = arr[i]
								if(node.flagDirty) node.flagDirty()
							}
						}
						if(worker){
							var obj = ONE.proxyDataEscape(v) || v
							var msg = {_type:'signal', _uid:this.__proxy__, name:prop, value:obj}
							//console.log('sig',msg)
							worker.sendToWorker(msg)
						}
					}
				})
			}
		}

		this._unbindProp = function(obj, prop){
			if(!obj) return
			var bind_store = '_bind_' + prop
			var arr = obj[bind_store]
			var i
			if(!Array.isArray(arr) || (i = arr.indexOf(this)) == -1){
				console.log('Unbind property error ' + prop, this.__proxy__)
				//throw new Error('unbind')
				return
			} 
			arr.splice(i, 1)
		}

		this.hasBinds = function(prop){
			var arr = this['_bind_' + prop]
			if(!arr || !arr.length) return false
			return true
		}

		this._initFrom = function(msg, worker, isupdate){
			var msg_uid = this.__proxy__ = msg._uid

			if(isupdate){
				if(this._cleanup) this._cleanup()
				if(this._deinitBinds) this._deinitBinds()
			}
		
			// copy stuff from msg
			for(var k in msg){
				if(k.charCodeAt(0)!= 95){
					// store it
					this[k] = msg[k]
				}
			}

			// define signal forwards
			var sigs = msg._sigs
			if(sigs){
				for(var i = 0, l = sigs.length; i < l; i++){
					this._bindProp(this, sigs[i], worker)
				}
			}

			var refs = msg._refs
			if(refs){
				for(var i = 0, l = refs.length; i < l; i++){
					var name = refs[i]
					var uid = this[name]
					if(typeof uid == 'number'){ // we need to resolve it
						var obj = worker.proxy_obj[uid]
						if(obj && !Array.isArray(obj)) this[name] = obj
						else{
							// make late resolve array
							var arr =  obj || (worker.proxy_obj[uid] = [])
							arr.push(this, name)
							this[name] = arr
						}
					}
				}
			}

			if(msg._code){
				// do some caching
				try{
				var fn = this.__proxy_cache__[msg._code] || 
						(this.__proxy_cache__[msg._code] = Function('__module__', msg._code))
				// execute on self to populate class

				fn.call(this, this.__proxy_module__)
				}
				catch(e){
					console.log(msg._code)
				}
			}

			// call init
			if(msg.__class__) this.__class__ = msg.__class__

			if(!this.hasOwnProperty('__class__')){
				if(!isupdate){
					if(this.prestructor) this.prestructor()
					if(this.constructor) this.constructor()
				}
				if(this._initBinds) this._initBinds()
			}
		}
	})


}

// recursively walk js datastructure and escape __proxy__ object refs
ONE.proxyDataEscape = function(data){
	// how do we store refs? {__proxy__}
	if(Array.isArray(data)){
		var out = []
		for(var k = 0; k < data.length;k++){
			var obj = ONE.proxyDataEscape(data[k])
			if(obj) data[k] = obj
		}
	}
	else if(data && typeof data == 'object'){
		if(data.__proxy__){
			return {__proxy__:data.__proxy__}
		}
		for(var k in data){
			var obj = ONE.proxyDataEscape(data[k])
			if(obj) data[k] = obj
		}
	}
}

// recursively walk js datastructure and unescape __proxy__ object refs
ONE.proxyDataUnescape = function(data, proxy_lut){
	// how do we store refs? {__proxy__}
	if(Array.isArray(data)){
		var out = []
		for(var k = 0; k < data.length; k++){
			var obj = ONE.proxyDataUnescape(data[k], proxy_lut)
			if(obj) data[k] = obj
		}
	}
	else if(data && typeof data == 'object'){
		if(data.__proxy__){
			return proxy_lut[data.__proxy__]
		}
		for(var k in data){
			var obj = ONE.proxyDataUnescape(data[k], proxy_lut)
			if(obj) data[k] = obj
		}
	}
}

ONE._createWorker = function(){
	var dt = Date.now()
	var source =
		'\nONE = {}' +
		'\nvar Assert'+
		'\nONE.init = ' + ONE.init.toString() +
		'\nONE.init_ast = ' + ONE.init_ast.toString() +
		'\nONE.base_ = ' + ONE.base_.toString() +
		'\nONE.proxy_ = ' + ONE.proxy_.toString() +
		'\nONE.ast_ = ' + ONE.ast_.toString() +
		'\nONE.zlib_ = ' + (ONE.zlib_?ONE.zlib_.toString():'undefined') +
		'\nONE.genjs_ = ' + ONE.genjs_.toString() +
		'\nONE.genjs_compat_ = ' + ONE.genjs_compat_.toString() +
		'\nONE.color_ = ' + ONE.color_.toString() +
		'\nONE.parser_strict_ = ' + ONE.parser_strict_.toString() +
		'\nONE.worker_boot_ = ' + ONE.worker_boot_.toString() +
		'\nONE.proxyDataUnescape = ' + ONE.proxyDataUnescape.toString() + 
		'\nONE.origin = "'+window.location.origin+'"'+
		'\nONE.compress_cache = ' +ONE.compress_cache+
		'\nONE.worker_boot_(self)'

	var blob = new Blob([source], { type: "text/javascript" })
	this._worker_url = URL.createObjectURL(blob)
	var worker = new Worker(this._worker_url)
	worker.source = source
	return worker
}
ONE.origin = window.location.origin
// Bootstrap code for the browser, started at the bottom of the file
ONE.browser_boot_ = function(){
	var worker
	
	// fake worker for debugging
	if(ONE.fake_worker){
		worker = {
			postMessage: function(msg){
				//setTimeout(function(){
				host.onmessage({data:msg})
				//},0)
			},
			onmessage:function(){}
		}
		var host = {
			postMessage: function(msg){
				setTimeout(function(){
				worker.onmessage({data:msg})
				},0)
			},
			onmessage: function(){}
		}
		ONE.worker_boot_(host)
	}
	else worker = ONE._createWorker()

	worker.proxy_cache = {}
	worker.proxy_obj = {}
	var dt = 0

	worker.msg_start = 0
	worker.msg_queue = []

	worker.msgFlush = function(){
		var msgs = this.msg_queue
		this.msg_start = Date.now()
		this.msg_queue = []
		this.postMessage(msgs)
	}.bind(worker)

	worker.sendToWorker = function(msg){
		var now = Date.now()
		if(this.msg_queue.length && now - this.msg_start > 10){ // make sure we chunk every 20ms for parallelisation
			this.msg_queue.push(msg)
			this.msgFlush()
		}
		else{
			if(this.msg_queue.push(msg) == 1){
				this.msg_start = now
				setTimeout(this.msgFlush, 0)
			}
		}
	}

	var proxy_module = {
		worker:worker
	}

	window.onkeypress = function(event){
		if(event.altKey && event.ctrlKey && event.keyCode == 18){
			cache_db.reset()
			location.reload()
		}
	}

	// lamo hash. why doesnt js have a really good one built in hmm?
	function string_hash(str){
		if(typeof str !== 'string') return 0
		var hash = 5381,
		i = str.length
		while(i) hash = (hash * 33) ^ str.charCodeAt(--i)
		return hash >>> 0
	}

	// our module cache database object
	var cache_db = {
		storage: localStorage,
		total_storage: 0,
		modules:{},
		source:{},
		hashes:{},
		proxify_hash:'',
		reset:function(){
			this.storage.clear()
		},
		init:function(callback){
			callback()
		},

		write_module:function(key, value){
			try{
				this.storage.setItem(key, value)
				this.total_storage += key.length + value.length
			}
			catch(e){
				console.log("clearing storage write_module")
				this.storage.clear()
			}
		},

		check_module:function(module_name, source_code, callback){
			this.source[module_name] = source_code
			this.hashes[module_name] = string_hash(source_code) 
			if(ONE.ignore_cache){
				worker.sendToWorker({_type:'parse', module_name:module_name, value:source_code})
				return callback()	
			}
			try{
				var data = this.storage.getItem(source_code)
			}
			catch(e){}
			if(!data){
				worker.sendToWorker({_type:'parse', module_name:module_name, value:source_code})
				return callback()	
			}
			try{
				if(ONE.compress_cache) data = ONE.inflate(data, {to:'string'})
				else if(data.charCodeAt(0) == 120 && data.charCodeAt(1) == 156) throw 1
				this.modules[module_name] = data
			}
			catch(e){
				worker.sendToWorker({_type:'parse', module_name:module_name, value:source_code})
				return callback()	
			}
			return callback()
		},

		get_proxify:function(callback){
			if(ONE.ignore_cache){
				return callback({})
			}
			try{
				var num = 0
				var key
				var cache = {}
				while(key = this.storage.getItem(this.proxify_hash + 'K' + num)){
					if(ONE.compress_cache) key = ONE.inflate(key, {to:'string'})
					else if(key.charCodeAt(0) == 120 && key.charCodeAt(1) == 156) throw 1
					var value = this.storage.getItem(this.proxify_hash + 'V' + num)
					if(value !== undefined){
						if(ONE.compress_cache) value = ONE.inflate(value, {to:'string'})
						else if(value.charCodeAt(0) == 120 && value.charCodeAt(1) == 156) throw 1

						cache[key] = value
					}
					num++
				}
				return callback(cache)
			}
			catch(e){
				console.log("clearing storage get_proxify")				
				localStorage.clear()
				callback({})
			}
		},
		proxify_local_storage:0,
		write_proxify:function(key, value){
			// lets get the right number
			while(this.storage.getItem(this.proxify_hash+'K'+this.proxify_local_storage)){
				this.proxify_local_storage++
			}
			try{
				var key1 = this.proxify_hash+'K'+this.proxify_local_storage
				if(ONE.compress_cache) key = ONE.deflate(key, {to:'string'})
				this.storage.setItem(key1, key)
				var value1 = this.proxify_hash+'V'+this.proxify_local_storage
				if(ONE.compress_cache) value = ONE.deflate(value, {to:'string'})
				this.storage.setItem(value1, value)
				this.total_storage += key1.length + key.length + value1.length + value.length
				this.proxify_local_storage++
			}
			catch(e){
				console.log("clearing storage write_proxify", e)				
				localStorage.clear()
			}
			return
		}
	}
	
	/*
	IndexedDB is nearly useless. THE WEB IS A PLATFORM. riiiiight. ffs. goddamn incompetent idiots.
	var cache_db = {

		db:undefined,
		modules:{},
		source:{},
		hashes:{},
		proxify_hash:'',
		reset:function(){
			try{
				window.indexedDB.deleteDatabase('onejs_cache_v1', 1)
			}
			catch(e){}
			try{
				localStorage.clear()
			}
			catch(e){}
		},
		init:function(callback){
			if(!window.indexedDB) return callback() // boo no caching

			var req = window.indexedDB.open("onejs_cache_v1", 1);
			req.onupgradeneeded = function(event){
				console.log('UPGRADING')
				this.db = event.target.result
				try{
					this.db.deleteObjectStore('modules')
					this.db.deleteObjectStore('proxify')
				}
				catch(e){}
				this.db.createObjectStore('modules',{keyPath:'key'})
				this.db.createObjectStore('proxify',{keyPath:'id', autoIncrement:true}).createIndex("hash", "hash", { unique: false });
			}.bind(this)

			req.onsuccess = function(event){
				this.db = event.target.result
				callback()
			}.bind(this)

			req.onerror = function(e){
				this.reset()
				callback()
			}.bind(this)
		},

		write_module:function(key, value){
			if(!this.db){
				try{
					localStorage.setItem(key, value)
				}
				catch(e){
					localStorage.clear()
				}
				return
			}
			try{
				var store = this.db.transaction("modules", "readwrite").objectStore("modules")
				store.put({'key':key,'value':value})
			}
			catch(e){
				cache_db.reset()
				console.log(e)
			}
		},

		check_module:function(module_name, source_code, callback){
			this.source[module_name] = source_code
			this.hashes[module_name] = string_hash(source_code) 
			// create a unique id for this module so we can use it to uniquely identify it
			// unique ids should depend on its dependencies otherwise shit goes fucked.
			

			if(ONE.ignore_cache){
				worker.sendToWorker({_type:'parse', module_name:module_name, value:source_code})
				return callback()	
			}
			try{
				if(!this.db){ // fall back to localStorage
					var data = localStorage.getItem(source_code)
					if(!data){
						worker.sendToWorker({_type:'parse', module_name:module_name, value:source_code})
						return callback()	
					}
					this.modules[module_name] = data
					return callback()
				}
				console.log(module_name, string_hash(source_code))
				var req = this.db.transaction('modules').objectStore('modules').get(source_code)
			}
			catch(e){
				cache_db.reset()
				console.log("Error loading cachedb", e)
				worker.sendToWorker({_type:'parse', module_name:module_name, value:source_code})
				return callback()
			}
			req.onerror = function(event){
				worker.sendToWorker({_type:'parse', module_name:module_name, value:source_code})
				callback()
			}.bind(this)

			req.onsuccess = function(event){
				if(!event.target.result){
					worker.sendToWorker({_type:'parse', module_name:module_name, value:source_code})
					return callback()
				}
				this.modules[module_name] = event.target.result.value

				callback()
			}.bind(this)
		},

		get_proxify:function(callback){
			if(ONE.ignore_cache){
				return callback({})
			}
			if(!this.db){
				var num = 0
				var key
				var cache = {}
				while(key = localStorage.getItem(this.proxify_hash+'K'+num)){
					var value = localStorage.getItem(this.proxify_hash+'V'+num)
					if(value !== undefined){
						cache[key] = value
					}
					num++
				}
				return callback(cache)
			}
			var cache = {}
			try{
				var req = this.db.transaction("proxify").objectStore("proxify").index("hash").openCursor( IDBKeyRange.only(this.proxify_hash), "next")
				req.onsuccess = function(event){
					var cursor = event.target.result
					if(!cursor){
						callback(cache)
					}
					else{
						cache[cursor.value.key] = cursor.value.value
						cursor.continue()
					}
				}
				req.onerror = function(event){
					callback({})
				}
			}
			catch(e){
				cache_db.reset()
				console.log(e)
				callback({})
			}
		},
		proxify_local_storage:0,
		write_proxify:function(key, value){
			if(!this.db){
				// lets get the right number
				while(localStorage.getItem(this.proxify_hash+'K'+this.proxify_local_storage)){
					this.proxify_local_storage++
				}
				try{
					localStorage.setItem(this.proxify_hash+'K'+this.proxify_local_storage, key)
					localStorage.setItem(this.proxify_hash+'V'+this.proxify_local_storage, value)
				}
				catch(e){
					localStorage.clear()
				}
				this.proxify_local_storage++
				return
			}
			try{
				var store = this.db.transaction("proxify", "readwrite").objectStore("proxify")
				store.add({'hash':this.proxify_hash, 'key':key, 'value':value})
			}
			catch(e){
				console.log(e)
			}
		}
	}
	*/

	worker.onmessage = function(event){
		var data = event.data
		// we have to create an object
		if(Array.isArray(data)){
			for(var i = 0, l = data.length;i < l;i++){
				var msg = data[i]

				//console.log(msg)
				if(msg._type == 'setref'){
					var on_obj = this.proxy_obj[msg._uid]
					if(!on_obj) throw new Error('Ref set on nonexistant object ' + msg._uid)
					var tgt_obj = this.proxy_obj[msg.value]
					if(!tgt_obj || Array.isArray(tgt_obj)){ // make late resolve array
						var arr =  tgt_obj || (this.proxy_obj[msg.value] = [])
						arr.push(on_obj, msg.name)						
					}
					else{
						on_obj[msg.name] = tgt_obj
					}
					if(on_obj.flagDirty) on_obj.flagDirty()
				}
				if(msg._type == 'setvalue'){
					var obj = this.proxy_obj[msg._uid]
					if(!obj) throw new Error('Value set on nonexistant object ' + msg._uid)
					var old = obj[msg.name]
					//!TODO make this nicer
					if(old && old._vb_) msg.value._vb_ = old._vb_
					obj[msg.name] = msg.value
					if(obj.hasOwnProperty('__class__')){
						console.log('Warning, sending update to a prototype ', msg)
					}
					else if(obj.flagDirty) obj.flagDirty()
				}
				else if(msg._type == 'call'){
					var obj = this.proxy_obj[msg._uid]
					if(!obj){
						//throw new Error('Call on nonexistant object ' + msg._uid)
						console.log('Call on nonexistant object ' + msg._uid)
					}
					else{
						var ret = obj[msg.name].apply(obj, msg.args)
						if(msg.callid){ // we need a return value
							// we realisticly need to process ret to be a cross thread dered.
							var obj = ONE.proxyDataEscape(ret)
							if(obj) ret = obj
							worker.sendToWorker({_type:'return', callid:msg.callid, ret:ret})
						}
					}
				}
				else if(msg._type == 'proxify'){
					// lets check our 
					var old_obj = this.proxy_obj[msg._uid]
					var obj
					// clean up late resolve
					if(old_obj && !Array.isArray(old_obj)){
						//console.log('update!')
						if(!old_obj.hasOwnProperty('__class__') && old_obj.flagDirty) old_obj.flagDirty()
						obj = old_obj
	
						obj._initFrom(msg, worker, true)
					}
					else{
						if(msg._proto == 0) obj = ONE.Base.HostProxy.new()
						else{
							var proxy_obj = this.proxy_obj[msg._proto]
							if(!proxy_obj) throw new Error("Cannot instantiate proxy object " + msg._proto)
							obj = Object.create(proxy_obj)
						}

						this.proxy_obj[msg._uid] = obj

						obj._initFrom(msg, worker, false)

						// do all late binds
						if(Array.isArray(old_obj)){
							for(var j = 0, k = old_obj.length; j < k; ){
								var tgt_obj = old_obj[j]
								var name = old_obj[j+1]
								if(name == null){ // its a late property bind
									name = old_obj[j+2]
									tgt_obj._bindProp(obj, name)
									j += 3
									if(!tgt_obj.hasOwnProperty('__class__') && tgt_obj.flagDirty) tgt_obj.flagDirty()
								}
								else{ // its a late reference resolve
									tgt_obj[name] = obj
									j += 2
									if(!tgt_obj.hasOwnProperty('__class__') && tgt_obj.flagDirty) tgt_obj.flagDirty()
								}
							}
						}
					}
				}
				else if(msg._type == 'module_cache'){
					cache_db.write_module(msg.key, msg.value)
				}
				else if(msg._type == 'proxify_cache'){ // we have to add stuff to our proxify cache
					cache_db.write_proxify(msg.key, msg.value)
				}
			}
		}
	}

	if(!ONE.fake_worker) ONE.init()

	function module_get( url, module_name ){
		return ONE.Base.wrapSignal(function(sig){
			var elem = document.getElementById(module_name)
			if(elem){
				var value = elem.innerHTML
				cache_db.check_module(module_name, value, function(){
					sig.end(value)
				})
				return
			}
			// do some XMLHTTP
			var pthis = this
			var req = new XMLHttpRequest()
			var timeout = undefined
			if(ONE.hammer_time){
				timeout = setTimeout(function(){
					if(timeout){
						req.onreadystatechange = undefined
						req = new XMLHttpRequest()
						req.onreadystatechange = result
						req.open("GET", url, true)
						req.send()
						//ONE.hacklog('FAIL: ' + url)
					}
				}, ONE.hammer_time)
			}
			req.open("GET", url, true)
			req.onreadystatechange = result
			function result(){
				if(req.readyState == 4){
					if(timeout) clearTimeout(timeout)
					timeout = undefined
					if(req.status != 200) return sig.throw(req.status)
					var value = req.responseText
					//ONE.hacklog("DONE: "+url)
					cache_db.check_module(module_name, value, function(){
						sig.end(value)
					})
				}
			}
			req.send()
		})
	}
	
	var type = "main"
	var root

	if(location.hash){
		root = location.hash.slice(1)
		var hack = location.hash.indexOf('?')
		if(hack !== -1) root = root.slice(0,hack-1)
	}
	else root = type
	
	function init(){
		var loader = {}
		// when do we resolve a module? when all its deps have been loaded.
		function load_dep( module_name, parent ){
			// lets load a module
			return ONE.Base.wrapSignal(function(sig){
				var url = module_name + '.n'
				var data_sig = loader[module_name]
				var first = false
				if(!data_sig){
					first = true
					data_sig = loader[module_name] = module_get(url, module_name)
				}
				// otherwise we only resolve sig
				data_sig.then(function(value){
					// okay lets scan for our dependencies
					var all = []
					if(first){
						value = value.replace(/import\s*\(\s*[\'\"]([^\'\"]*?)[\'\"](?:\s*,\s*[\'\"]([^\'\"]*?)[\'\"])?\s*\)/g, function(m, url, responseType){
							worker.sendToWorker({_type:'import', url:url, responseType:responseType})
							return ''
						})
					}
					value.replace(/import\s+(\w+)/g, function(m, mod){
						all.push(load_dep(mod, module_name))
					})

					ONE.Base.allSignals(all).then(function(){
						if(first){
							var cached_module = cache_db.modules[module_name]
							if(cached_module)
								worker.sendToWorker({_type:'eval_cached', module_name:module_name, value:cached_module })
							else
								worker.sendToWorker({_type:'eval', module_name:module_name})
						}
						else first = false
						sig.end()
					}, 
					function(err){
						sig.throw(err)
					})
				}, 
				function(err){
					sig.throw(err)	
				})
			})
		}
		load_dep(root, 'boot').then(function(){
			// lets make the proxy_cache key 
			var nodes = Object.keys(cache_db.source).sort()
			// build a very crappy cache key. in the future we use module names
			var hash = string_hash(worker.source)
			for(var i = 0;i<nodes.length;i++){
				var key = nodes[i]
				if(!ONE.prototype_mode || key !== root) // ignore the root in the proxy cache.. shoudlnt do this really
				    hash += key + '=' + cache_db.hashes[key]
			}
			cache_db.proxify_hash = hash
			cache_db.get_proxify(function(data){
				worker.sendToWorker({_type:'run', module_name:root, proxify_cache:data})	
			})				
		})
	}

	if(location.hostname.match(/(.*?)\.onejs\.io/)){
		window.addEventListener("load", function(){
			cache_db.init(init)
		})
	}
	else{
		cache_db.init(init)
	}
	
	// initialize ONEJS also on the main thread	
	if(!ONE.fake_worker) ONE.init_ast()
	if(location.hash) ONE.reloader()
	/*	
	window.onerror = function(msg, url, line) {
		var name = url.match(/[^\/]*$/)[0]
		console.log(msg + ' in '+name+' line '+line)
		return false
	}*/
} 

ONE.browser_boot_()