
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

"use strict"

if(typeof window !== 'undefined') window.ONE = {}
else ONE = {}

ONE.init = function(){

	// make ONE a class
	this.base_()
	
	this.__class__ = 'ONE'
	// create base class
	this.base_.call(this.__Base__ = {})
	this.__Base__.__Base__ = this.__Base__
	this.Base =  this.__Base__ 
	this.Base.Base = this.__Base__

	this.__Base__.hideProperties(Object.keys(ONE.__Base__))

	// make ONE the new root scope
	this.__Base__.__modules__ = this.__modules__ = Object.create(null)

	// global drawloop
	this.drawloop = []

	if(this.zlib_) this.zlib_()
}

ONE.base_ = function(){
	
	this.__class__ = 'Base'
	// inherit a new class, whilst passing on the scope
	this.extend = function( outer, role, selfname, nopost ){

		// variable API
		if(typeof outer == 'string') selfname = outer, outer = this
		else if(typeof outer == 'function')  selfname = role, role = outer, outer = this
		else if(typeof role == 'string') selfname = role, role = outer, outer = this

		var obj = Object.create(this)

		obj.__class__ = selfname || 'unknown-class'
		obj.defineProperty('__class__', { enumerable:false, configurable:true })
		
		// allow reference to self on inherited classeshttp://worrydream.com/refs/Hamming-TheArtOfDoingScienceAndEngineering.pdf
		if(selfname && selfname.indexOf(':') == -1) obj[selfname] = obj

		if(obj._extendPre) obj._extendPre()

		// lets auto-extend all deep classes
		if(obj.__deep__){
			var deep = obj.__deep__
			obj.__deep__ = Object.create(null)
			for(var k in deep){
				obj.__deep__[k] = deep[k].extend(obj, undefined, obj.__class__+':'+k, true)
			}
		}
		
		if(role){
			if(typeof role == 'function') role.call(obj, outer)
			else obj.import(role)
		}
		// this flag causes all deep classes to extendPost together 'after' the outer 
		// class has completed its role call
		if(!nopost) if(obj._extendPost) obj._extendPost()

		return obj
	}

	this._extendPost = function(){
		if(this.__deep__){
			var deep = this.__deep__
			for(var k in deep){
				deep[k]._extendPost()
			}
		}
	}

	// new an object with variable arguments and automatic parent/owner
	this.new = function(){
		var obj = Object.create(this)

		if(obj.prestructor) obj.prestructor.apply(obj, arguments)
		if(obj.__deep__) obj.deepNew()
		if(obj.constructor) obj.constructor.apply(obj, arguments)

		return obj
	}
	
	this.deepNew = function(){
		// construct deep objects
		var deep = this.__deep__
		this.__deep__ = Object.create(null)
		for(var k in deep){
			this.__deep__[k] = deep[k].new(this)
		}
	}

	this.deepExtend = function(owner, name, nest){
		if(!owner.__deep__) owner.__deep__ = Object.create(null)

		var obj = this.extend(owner, nest, this.__class__ + ':' + name)
		// store it
		owner.__deep__[name] = obj
		owner.defineProperty(name, {
			enumerable:true,
			configurable:false,
			get:function(){
				return this.__deep__[name]
			},
			set:function(v){
				if(typeof v == 'function'){
					v.call(this.__deep__[name])
				}
				else throw new Error('Cannot assign type to deep class')
			}
		})
		return obj
	}

	this.call = function(pthis, nest, owner){
		var obj = Object.create(this)

		if(obj.prestructor) obj.prestructor.call(obj, owner)
		if(obj.__deep__) obj.deepNew()
		nest.call(obj)
		if(obj.constructor) obj.constructor.call(obj, owner)

		return obj
	}

	this.isClass = function(){
		return this.hasOwnProperty('__class__')
	}

	this.isInstance = function(){
		return !this.hasOwnProperty('__class__')
	}

	this.dontProxy = function(){
		for(var i = 0;i<arguments.length;i++){
			this['_dontproxy_'+arguments[i]] = 1
		}
	}

	this.prototypeOf = function( other ){
		return this.isPrototypeOf( other )
	}

	// plain value storage wrapper for overloads
	function StackValue(v){
		this.v = v
	}
	
	// load a property bag onto my object
	this.load = function( irole , dbg){
		var role = irole
		if(irole === undefined){
			throw new Error("Loading undefined role")
		}
		if(typeof irole == 'string'){// try to read it from scope
			role = this.__modules__[irole]
			if(!role) throw new Error("Cannot find role "+irole+" on this")
		}

		if(typeof role == 'function'){
			role.call(base)
			return
		}
		if(typeof role == 'object'){
			for(var key in role){
				var set = role.__lookupSetter__(key)
				var get = role.__lookupGetter__(key)
				if(get || set){
					Object.defineProperty(this, key, {
						get:get, set:set, enumerable: true, configurable:true
					})
				}
				else{
					// we might have to copy things
					this[key] = role[key]
				}
			}
		}
	}

	// import a module
	this.import = function( name ){
		// lets import a module!
		var module = this.__modules__[name]

		if(!module) throw new Error("Cannot find module "+name)
		var instance = module.instance

		if(!instance){
			module.instance = instance = this.__Base__.new(this)
			if(!module.compiled_function)
				throw new Error("Module "+name+" has no compiled function")
			module.compiled_function.call(instance)
		}
		return instance
	}

	// Internal prefixes:
	// __xx = computed value storage
	// __xx__ = class datastructures
	// $ = scope object

	// learn a property bag, creates undo stacks so forget works.
	this.learn = function( ){

		var roles
		if(!this.hasOwnProperty('__roles__')){
			roles = this.__roles__ = [] 
			Object.defineProperty( this, '__roles__', {enumerable:false, configurable:false} )
		} 
		else roles = this.__roles__
		
		// prepare learn array
		var learn = []
		for(var i = 0, len = arguments.length; i < len; i++){
			var role = arguments[ i ]

			if(typeof role == 'function'){
				var obj = Object.create(ONE.__Base__)
				obj.__teach__ = this
				obj.__role__ = role
				if(i == 0 && arguments.length > 1) role.apply(obj, Array.prototype.slice(arguments, 1))
				else role.call(obj, this)
				role = obj
			} 

			if(typeof role != 'object') throw new Error("Cannot learn role " + role)
			if(roles.indexOf(role) == -1){
				roles.push(role)
				learn.push(role)
			}
		}

		if(!learn.length) return this

		// learn the array
		for(var i = 0, len = learn.length; i < len; i++){
			var source = learn[i]
			for(var k in source){
				// skip keys starting with _ or $ on_
				if(k[0] === '_' || k[0] === '$' || k[0] == 'o' && k[1] == 'n' && k[2] == '_') continue
				// push the value
				this.push(k, source['__' + k] || source[k], source)
			}
		}
	}

	// forget a property bag
	this.forget = function( role ){
	   if(!this.hasOwnProperty('__roles__')) return
		
		var forget = []
		var roles = this.__roles__

		if(!roles.length) return

		// prepare forget array
		var num = 0
		for(var i = 0, len = arguments.length; i < len; i++){

			var role = arguments[i]

			if(typeof role == 'number'){
				num = role
				continue
			}

			if(typeof role == 'function'){
				for(var i = 0; i < roles.length; i++){
					if(roles[ i ].__role__ ===  role){
						forget.push(roles[i])
						roles.splice(i, 1)
						break
					}
				}
			}
			else if (typeof role == 'object'){
				var i = roles.indexOf(role)
				if( i !== -1 ) { 
					forget.push(role)
					roles.splice(i, 1)
				}
			} 
		}
		if(num !== 0) forget.push.apply(forget, roles.splice(-num, num))
		if(!forget.length) return

		// forget the properties
		for(var i = forget.length -1; i >= 0; i--){
			// restore a property as best we can
			var source = forget[i]
			
			for(var k in source){
				// skip variable
				if(k[0] === '_' || k[0] === '$' || k[0] == 'o' && k[1] == 'n' && k[2] == '_') continue
				// pop the value
				this.pop(k, source)
			}
		}
	}

	// push a property on the overload stack
	this.push = function( key, value, marker ){
		var overloads
		if(!this.hasOwnProperty('__overloads__')){
			overloads = this.__overloads__ = Object.create(null)
			Object.defineProperty(this, '__overloads__', {enumerable:false, configurable:false})
		} 
		else overloads = this.__overloads__
		
		var stack = overloads[key] || (overloads[key] = [])
		// we might be a signal
		var sigkey = '__' + key
		var this_sig = this[sigkey]

		if(typeof value == 'function') value.__supername__ = key

		var top_val 
		if(stack.length){
			var top = stack[stack.length - 1]
			if(top instanceof StackValue) top_val = top.v
			else {
				var top_sig = top[sigkey]
				if(top_sig) top_val = top_sig.value
				else top_val = top[key]
			}
		}

		if(this_sig && this_sig._signal_){
			if(top_val !== this_sig.value)
				stack.push(new StackValue(this_sig.value))

			if(value && value.toString == ONE.signal_type){
				this_sig.mergeSignal(value)
				// call the signal setters
				this[key] = value.value
			}
			else{
				// just set the value
				this[key] = value
			}
		}
		else{
			// only push value on the stack if
			// stack top doesnt store it
			var val = this[key]
			if(top_val !== val)
				stack.push(new StackValue( val ))

			if(value && value._signal_){ // we are pushing a signal
				// convert self to signal
				var sig = this.signal(key, this[key])
				sig.mergeSignal(value)
				this[key] = value.value
			}
			else{
				this[key] = value
			}
		}
		if(marker) stack.push(marker)
	}

	// pop a property off the overload stack
	this.pop = function( key, marker ){
		if( !this.hasOwnProperty('__overloads__') ) return

		var stack = this.__overloads__[key]
		if(!stack || !stack.length ){
			this[key] = undefined
			return
		}

		var sigkey = '__' + key

		if(!marker){
			var top = stack[stack.length - 1]
			if(top === undefined){
				this[key] = undefined
			}
			else {
				if(top instanceof StackValue){
					// dont re-add a listener method
					if(!this[sigkey] || typeof top.v != 'function')
						this[key] = top.v
				}
				else{
					var newtop_sig = top[sigkey]
					if(newtop_sig !== undefined){
						if(newtop_sig._signal_) this[key] = newtop_sig.value
						else this[key] = newtop_sig
					}
					else {
						if(!this[sigkey] || typeof top.v != 'function')
							this[key] = top[key]
					}
				}
			}
			return stack.pop()
		}

		// fetch value on this
		var this_val
		var this_sig = this[sigkey]
		if(this_sig !== undefined){
			if(this_sig._signal_) this_val = this_sig.value
			else this_val = this_sig
		} 
		else this_val = this[key]

		// fetch value on marker
		var marker_val
		var marker_sig = marker[sigkey]
		if(marker_sig !== undefined){
			if(marker_sig._signal_)
				marker_val = marker_sig.value
			else marker_val = marker_sig
		}
		else marker_val = marker[key]

		// look up the marker in our stack
		var idx = stack.indexOf(marker)

		if(idx != -1){ // okay so.
			if(marker_sig && marker_sig._signal_){ // unmerge the markers signal
				if(!this_sig) throw new Error('marker has signal, but this has not')
				this_sig.unmergeSignal(marker_sig)
			}// remove the listener
			else if(this_sig && this_sig._signal_ && typeof marker_val == 'function'){
				this_sig.removeListener(marker_val, 'set_list')
			}
			// we are top of the stack, and we havent messed with the value
			if(idx === stack.length - 1 && this_val === marker_val){
				stack.pop() // pop the marker
				// pop the stack to assign the new stacktop
				stack.push(this.pop(key)) // use the tophalf of this function to pop 
			}
			// remove the marker from the stack				
			stack.splice(idx, 1)
		}
	}


	// Make properties non enumerable
	this.hideProperties = function( enums ){
		if(!enums) enums = Object.keys(this)
		for( var i = enums.length - 1; i>=0; i--){
			var k = enums[i]
			Object.defineProperty( this, k, {enumerable:false, configurable:true})
		}
	}

	this.now = (function(){
		var p = typeof window !== 'undefined' && window.performance || {}
		return (p.now && p.now.bind(p)) ||
			(p.webkitNow && p.webkitNow.bind(p)) ||
			(p.msNow && p.oNow.bind(p)) ||
			(p.oNow && p.oNow.bind(p)) ||
			(p.mozNow && p.mozNow.bind(p)) ||
			function(){ return Date.now() }
	})()

	// Quickly profile things
	this.profile = function( msg, times, call ){
		var tm = this.now()
		if(arguments.length == 1) call = msg, times = 1, msg = ''
		if(arguments.length == 2) call = times, times = msg, msg = ''
		var ret
		for( var i = 0; i < times; i++ ){
			ret = call.call( this, i )
		}
		tm = this.now() - tm
		console.log("profile " + msg + " " + Math.ceil(tm) + 'ms')
		return ret
	}

	// Finding the thing you overloaded, for anything besides objects
	// and functions this is a 'probably' since it cant uniquely identify the value
	this.overloads = function( key, me ){
		var proto = this
		var next // flags if the next item is the one i want
		var ret // return value of recur
		// recursive Role scanner
		function recur( obj ){
			if(obj.hasOwnProperty(key)){
				var val = obj[key]
				if(next && val != me) return ret = val
				if(val == me) next = 1
			}
			if(obj.hasOwnProperty( '__overloads__')){
				var stack = obj.__overloads__[key]
				if(stack) for(var i = stack.length - 1; i >= 0; i--){
					var item = stack[ i ]
					if(next){
					   var val = item instanceof StackValue ? item.v : item[key]
					   if(val != me) return ret = val
					}
					if(item instanceof StackValue){
						if(item.v == me) next = 1
					} else if(recur(item)) return ret
				}
			}
		}
		while(proto){
			if(recur(proto)) return ret
			proto = Object.getPrototypeOf(proto)
		}
	}
	 
	// Calls the function you overloaded, works with roles and prototypes
	// utilizes a __supername__ property on your function to quickly find out
	// the name of function to traverse the prototype and overload objects
	// Call as this.super( arguments ) in the overloaded function 
	// Depends on arguments.callee to fetch the function you want to
	// call super on
	// or to change the args: this.super( arguments, newarg1, newarg2 )

	this.super = function( args ){
		// figure out arguments
		var me = args.callee || args
		var fnargs = args
		// someone passed in replacement arguments
		if( arguments.length > 1 ) fnargs = Array.prototype.slice.call( arguments, 1 )
		// look up function name
		var name = me.__supername__
		if( name !== undefined ){ // we can find our overload directly
			var fn = this.overloads(name, me)
			if(fn && typeof fn == 'function') return fn.apply(this, fnargs)
		} 
		else { // we have to find our overload in the entire keyspace
			for(var k in this) {
				// filter out the internal properties
				if( !(k in ONE.__Base__) && k[0] != '_' && (k[1] != '$' || k[1] != '_') && 
					(k[0] != '$' || k.length > 1 )){
					fn = this.overloads( k, me )
					if( fn && typeof fn == 'function' ) {
						me.__supername__ = k // store it for next time
						return fn.apply( this, fnargs )
					}
				}
			}
		}
	}

	// keys
	this.keys = function( ){
		return Object.keys(this)
	}

	// flush an entire property stack
	this.popAll = function( key ){
		if( !this.hasOwnProperty('__overloads__') ) return
		var overloads = this.__overloads__
		var stack = overloads[ key ]
		if(! stack || !stack.length ) return
		stack.length = 0
	}
	
	// return the property at index in the stack
	this.stackAt = function( key, idx ){
		if( !this.hasOwnProperty('__overloads__') ) return
		var overloads = this.__overloads__
		var stack = overloads[ key ]
		if(! stack || !stack.length ) return
		if( idx < 0 ) var last = stack[ stack.length - idx ]
		else var last = stack[ idx ]
		if( !last ) return
		return last instanceof StackValue ? last.v : last[ key ] 
	}
   
	// bind the signals
	this.bindSignals = function(){
		// we bind the signals late

		var sigbinds = this.__$sigbinds
		if( sigbinds ){
			for( var k in sigbinds ){
				this[ k ] = sigbinds[ k ]
			}
		}
	}

	// define a property
	this.defineProperty = function( key, def ){
		Object.defineProperty( this, key, def )
	}

	// lets store some constraints
	this.__constraint__ = 
	this.constraint = function(expr){
		if(!this.hasOwnProperty('__constraints__')){
			Object.defineProperty(this, '__constraints__', {enumerable:false, configurable:true, value:[]})
		}
		this.__constraints__.push(expr)
	}

	this.__signal__ = 
	this.signal = function( key, value, setter ){
		var signalStore = '__' + key
		var sig =  this[signalStore]
		if(!sig){ 
			sig = this[signalStore] = this.propSignal(key, setter)
			//Object.defineProperty(this, signalStore, { enumerable:false, configurable:true })
			// make a getter/setter pair
			Object.defineProperty(this, 'on_' + key, {
				configurable:true,
				enumerable:false,
				get:function(){
					var sig = this[signalStore]					
					// make an instance copy if needed
					if(sig.parent != this){
						sig = this[signalStore] = this.forkSignal(sig)
						//Object.defineProperty(this, signalStore, { enumerable:false, configurable:true })
					}
					return sig
				},
				set:function(value){
					throw new Error('Cant assign to on_' + key + ', assign to ' + key + ' instead')
				}
			})
			Object.defineProperty(this, key, {
				configurable:true,
				enumerable:true,
				get:function(){
					var sig = this[signalStore]					
					return sig.value
				},
				set:function(value){
					var sig = this[signalStore]
					// make instance copy if needed
					if(sig.parent != this){
						sig = this[signalStore] = this.forkSignal(sig)
						//Object.defineProperty(this, signalStore, { enumerable:false, configurable:true })
					}
					sig.set(value)
				}
			})
		}
		else if(sig.parent != this){
			sig = this[signalStore] = this.forkSignal(sig)
			//Object.defineProperty(this, signalStore, { enumerable:false, configurable:true })
		}
		if(value !== undefined) sig.set(value)
		return sig
	}

	this.trace = function(){ console.log.apply(console, arguments); return arguments[0];}

	this.__Signal__ =
	this.Signal = {}

	this.Signal.__class__ = 'Signal'
	this.Signal._signal_ = 1

	this.Signal.new = function(parent){
		var sig = Object.create(this)
		sig.parent = parent
		return sig
	}

	this.Signal.removeListener = function( cb, set ){
		set = set || 'set_list'
		var arr = this[set]
		if(arr === cb){
			this[set] = undefined
			return
		}
		if(!Array.isArray(arr)) return
		var idx = arr.indexOf(cb)
		if(idx == -1) return
		arr.splice(idx, 1)
		if(arr.length == 1) this[set] = arr[0]
		else if(arr.length == 0) this[set] = undefined
	}

	this.Signal.enumListeners = function( set, cb ){

		var proto = this
 		while(proto){
 			if(proto.hasOwnProperty(set)){
 				var list = proto[set]
				if(!Array.isArray(list)) cb(list)
				else for(var i = 0, l = list.length; i < l; i++){
					cb(list[i])
				}
			}
			proto = Object.getPrototypeOf(proto)
		}
	}
	
	// call all set listeners
	this.Signal.emit = 
	this.Signal.callListeners = function( _value ){

		var value = _value === undefined? this.value: this.value = _value
		var parent = this.parent
		var proto = this
		var list
		var ret
		while(proto){
			if(proto.hasOwnProperty('set_list') && (list = proto.set_list)){
				if(!Array.isArray(list)) ret = list.call(parent, value, this)
				else for(var i = 0, l = list.length; i < l; i++){
					ret = list[i].call(parent, value, this)
				}
			}
			proto = Object.getPrototypeOf(proto)
		}
		return ret
	}

	this.Signal.hasListeners = function(set){
		set = set || 'set_list'
		var proto = this
 		while(proto){
 			if(proto.hasOwnProperty(set)){
 				var list = proto[set]
				if(!Array.isArray(list)) return true
				else if(list.length) return true
			}
			proto = Object.getPrototypeOf(proto)
		}
		return false
	}

	// listen to the end  / error
	this.Signal.then = function( end_cb, error_cb ){
		if(this.ended){
			if(this.errored) setTimeout(function(){
					error_cb.call(this, this.exception)	
				}.bind(this), 0)
			else {
				setTimeout(function(){
					end_cb.call(this, this.value)	
				}.bind(this), 0)
			}
			return
		}
		if(end_cb){
			if(!this.hasOwnProperty('end_list')) this.end_list = end_cb
			else if(!Array.isArray(this.end_list)) this.end_list = [this.end_list, end_cb]
			else this.end_list.push( end_cb )
		}

		if(error_cb){
			if(!this.hasOwnProperty('error_list')) this.error_list = error_cb
			else if(!Array.isArray(this.error_list)) this.error_list = [this.error_list, error_cb]
			else this.error_list.push( error_cb )
		}
	}

	this.Signal.mergeSignal = function(other){
		var _this = this
		other.enumListeners('set_list', function(v){
			_this.onSet(v)
		})
		other.enumListeners('end_list', function(v){
			_this.onEnd(v)
		})
		other.enumListeners('error_list', function(v){
			_this.onError(v)
		})
	}

	this.Signal.unmergeSignal = function(other){
		var _this = this
		other.enumListeners('set_list', function(v){
			_this.removeListener(v, 'set_list')
		})
		other.enumListeners('end_list', function(v){
			_this.removeListener(v, 'end_list')
		})
		other.enumListeners('error_list', function(v){
			_this.removeListener(v, 'error_list')
		})
	}

	// listen to set
	this.Signal.bind = 
	this.Signal.onSet = function( set_cb ){
		if(!this.hasOwnProperty('set_list') || !this.set_list) this.set_list = set_cb
		else if(!Array.isArray(this.set_list)) this.set_list = [this.set_list, set_cb]
		else this.set_list.push(set_cb)

		if(this.monitor) this.monitor.call(this.parent, set_cb, 'set')

		var sub = Object.create(SetSubscription)
		sub.signal = this
		sub.cb = set_cb
		return sub
	}

	// set the signal value
	this.Signal.call = 
	this.Signal.set = function(value){
		if(this.ended) throw new Error('Cant set an ended signal')
		
		if(typeof value == 'function'){
			if(value._signal_){
				value = value.value
			}
			else return this.bind(value)
		}

		this.value = value
		// call all our listeners
		var proto = this 
		var parent = this.parent
		if(this.setter) this.setter.call(parent, value)
		var list
		while(proto){
			if(proto.hasOwnProperty('set_list') && (list = proto.set_list)){
				if(!Array.isArray(list)) list.call(parent, value)
				else for(var i = 0, l = list.length; i < l; i++){
					list[i].call(parent, value)
				}
			}
			proto = Object.getPrototypeOf(proto)
		}
	}

	// listen to the end signal
	this.Signal.onEnd = function(end_cb){
		if(!this.hasOwnProperty('end_list') || !this.end_list) this.end_list = end_cb
		else if(!Array.isArray(this.end_list)) this.end_list = [this.end_list, end_cb]
		else this.end_list.push(end_cb)

		var sub = Object.create(EndSubscription)
		sub.signal = this
		sub.cb = cb

		if(this.monitor) this.monitor.call(this.parent, set_cb, 'end')

		return sub
	}

	// end the signal
	this.Signal.resolve = 
	this.Signal.end = function(value){
		this.set(value)
		this.ended = true
		// call end
		var proto = this 
		var parent = this.parent
		var list
		while(proto){
			if(proto.hasOwnProperty('end_list') && (list = proto.end_list)){
				if(!Array.isArray(list)) list.call( parent, value, this )
				else for(var i = 0, l = list.length; i < l; i++){
					list[i].call( parent, value, this )
				}
			}
			proto = Object.getPrototypeOf(proto)
		}
	}

	// default allows a throw to be transformed to a value
	this.Signal.default = function(default_cb){
		if('default_cb' in this) throw new Error('Cannot overload defaults')
		this.default_cb = default_cb
		return this
	}
	
	// catch is chainable with await
	this.Signal.catch = function(error_cb){
		this.onError(error_cb)
		return this
	}

	this.Signal.onError = function(error_cb){
		if(!this.hasOwnProperty('error_list') || !this.error_list) this.error_list = error_cb
		else if(!Array.isArray(this.onThrow)) this.error_list = [this.error_list, error_cb]
		else this.error_list.push( error_cb )

		var sub = Object.create(ErrorSubscription)
		sub.signal = this
		sub.cb = error_cb

		if(this.monitor) this.monitor.call(this.parent, set_cb, 'error')

		return sub
	}
	
	// make the signal error
	this.Signal.reject =
	this.Signal.throw = 
	this.Signal.error = function(value, next){
		if(this.ended) throw new Error('Cant error ended signal')
		if(this.default_cb) return this.end( this.default_cb(value) )
		
		this.ended = true
		this.errored = value
		// call error
		var proto = this 
		var parent = this.parent
		var handled
		var list
		while(proto){
			if(proto.hasOwnProperty('error_list') && (list = proto.error_list)){
				handled = true
				if(!Array.isArray(list)) list.call(parent, value, next, this)	
				else for(var i = 0, l = list.length; i < l; i++){
					list[i].call(parent, value, next, this)
				}
			}
			proto = Object.getPrototypeOf(proto)
		}			
		return handled
	}

	this.createSignal = function(){
		var sig = Object.create(this.Signal)
		sig.parent = this
		return sig
	}

	// subscription classes
	function cancel_subscription(){
		if(!this.signal) return
		this.signal.removeListener(this.cb, this.set)
		this.signal = undefined
	}

	var SetSubscription = {
		set: 'set_list',
		cancel: cancel_subscription
	}

	var ErrorSubscription = {
		set: 'error_list',
		cancel: cancel_subscription
	}

	var EndSubscription = {
		set: 'end_list',
		cancel: cancel_subscription
	}

	
	// signal wrapper
	this.__wrapSignal__ =
	this.wrapSignal = function( wrap ){
		var sig = Object.create(this.Signal)
		sig.parent = this
		wrap(sig)
		return sig
	}

	this.allSignals = function( array ){
		var sig = Object.create(this.Signal)
		sig.parent = this
		if(!array || !array.length){
			sig.end()
			return sig
		}
		var deps = array.length
		var res = []
		for(var i = 0, l = deps; i < l; i++){
			array[i].then(function(value){
				if(sig){
					res[this] = value
					if(!--deps){
						sig.end(res)
						sig = null
					}
				}
			}.bind(i),
			function(err){
				if(sig) sig.error(err)
				sig = null
			})
		}
		return sig
	}

	this.propSignal = function( key, setter ){
		var sig = Object.create(this.Signal)

		sig.parent = this
		sig.key = key
		sig.setter = setter

		return sig
	}

	// fork a signal
	this.forkSignal = function( signal ){
		var sig  = Object.create(signal)
		sig.parent = this
		return sig
	}

	this.deepEqual = function(a, b){
		if(typeof a == 'object'){
			if(Array.isArray(a)){
				if(!Array.isArray(b) || a.length != b.length) return false
				for(var i = 0, l  = a.length;i<l;i++){
					if(a[i] !== b[i]) return false
				}
				return true
			}
			var k_a = Object.keys(a)
			var k_b = Object.keys(b)
			if(k_a.length !== k_b.length) return false
			for(var i = 0, l = k_a.length; i<l; i++){
				var key = k_a[i]
				if(a[key] !== b[key]) return false
			}
			return true
		}
		return a === b
	}
}
