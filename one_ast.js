
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

// ONEJS AST code generators
ONE.init_ast = function(){
	// add ast support to the Base class
	this.ast_.call(this.Base)
	this.color_()
	if(this.proxy_) this.proxy_.call(this.Base)

	this.Base.hideProperties( Object.keys( ONE.Base ) )
}

ONE.ast_ = function(){

	// include the parser
	var parser_normal = {}
	ONE.parser_strict_.call( parser_normal )

	var parser_live = Object.create(parser_normal)
	//parser_live.snapToAST = true
	//parser_live.debugging = true
	//parser_live.dont_strip = true
	this.parseLive = function( source, filename ){
		return this._parse(source, undefined, undefined, undefined, filename, true, parser_live)
	}
	this.parseLive.parser = parser_live

	// external parse api
	this.parse = function( source, filename ){
		return this._parse(source, undefined, undefined, undefined, filename, true, parser_normal)
	}

	// expose the parser object
	this.parse.parser = parser_normal
	
	// internal parse api used by compiler
	this._parse = function( source, module, locals, template, filename, noclone, parser){
		if(!parser) parser = parser_normal

		parser.sourceFile = filename || ''
        //console.log('parsing', source)
		var node = module && module.parser_cache[source]
		if(! node ){
			node = parser.parse_strict( source )

			if(!parser.dont_strip){
				if(node.steps.length == 1){
					node = node.steps[0]
				}
			}	
			if(module) module.parser_cache[source] = node
		}

		if(!noclone){
			if( template ){
				var template_nodes = []
				node = this.AST.clone( node, template_nodes )
			} 
			else {
				node = this.AST.clone( node )
			}
		}
		node.locals = locals
		node.source = source
		node.module = module
        
		// we now need to process our template-replaces
		if( template ){
			var nodes = template_nodes
			var copy = this.AST.Copy
			// we now need to overwrite the nodes in our tree with 
			// the template nodes
			for( var i = 0; i < nodes.length; i++ ){
				var tgt = nodes[i]
				var src = template[tgt.arg.name]
				if(!src) throw new Error("Template variable not found: " + tgt.arg.name)
                
				// clean ret the node
				tgt.prefix = undefined
				tgt.op = undefined
				tgt.arg = undefined
				if(typeof src == 'object'){
					copy[src.type](src, tgt)
				} 
				else{
					tgt.type = 'Value'
					if(typeof src == 'string')
						tgt.raw = '"'+src+'"'
					else
						tgt.raw = src
				}
			}
		}
		return node
	}

	this.eval = function( ast, module_name ){
		if(!ast) throw new Error('no ast', module_name)
		if( typeof ast == 'string' ){ 
			// lets first do a local storage scan.
			
			if(code){
				var fn = Function.call(null, code)()
				return fn
			}
			ast = this.parse(ast, module_name)// undefined, undefined, undefined, module_name, true )
		}
		// alright we have to compile us some code!
		var js = this.AST.ToJS
        
		// set up new compile state
		js.new_state(ONE.__modules__[module_name])

		if(ast.module){
			js.module = ast.module
			js.locals = ast.locals
		}
		else if(module_name && module_name._ast_ && module_name.module){
			js.module = module_name.module
			js.locals = module_name.locals
		}

		// if passing a function we return that
		if(ast.type == 'Function'){
			ast.root = true
			var flags = js.pull_flags(ast)
            
			if(flags){
				if(flags.indexOf('ast')!= -1) console.log( this.AST.toDump(ast) )
				if(flags.indexOf('code')!=-1){
					var code = this.AST.ToCode
					ONE.log( code.Function(ast) )
				}
			}
			// name anonmous function with a module_name if possible
			var nametag
			if(module_name) nametag = 'module__'+module_name.replace(/[\.\/]/g,'_')
			var code = 'return ' + js.Function( ast, nametag )
            
			// prepend type methods
			for(var k in js.type_methods){
				code = js.type_methods[k] + code
			}
			if(flags && flags.indexOf('js')!=-1) console.log( code )
            
			try{
				if( typeof process !== 'undefined'){
					var fn = Function.call(null, '__module__', 'process', 'require', '__dirname', code)(js.module, process, require, __dirname)
				}
				else{
					var prof = flags && flags.indexOf('profile') != -1 && Date.now()
                    
                    var fn = Function.call(null, '__module__', '__locals__', code)(js.module, js.locals)
                    
					if(prof) console.log('Profile ' +module_name + ' '+ (Date.now()-prof)+'ms')
				}
            
			} 
			catch(e){
				console.log("Eval error " + e + code)
			}
			js.module.generated_js = code
			return fn
		}
        
		var code = (this.AST.isExpr(ast)?'return ':'') + js.expand( ast )
		for(var k in js.type_methods){
			code = js.type_methods[k] + code
		}
        
		var run = Function('__module__','__locals__', code)
		return run.call(this, js.module, js.locals)
	}

	this.serializeModule = function(module){
		var blob = {
			name: module.name,
			generated_js: module.generated_js,
			types:{},
			local_types:{},
			parser_cache:{},
			imports:[],
			exports:{},
			defines:{},
			macros:{}
		}
		// lets serialize the types
		var types = module.types
		for(var type_name in types){
			var in_type = types[type_name]
			blob.types[type_name] = this.typeCopy(in_type)
		}

		// lets serialize the types
		var local_types = module.local_types
		for(var type_name in local_types){
			var in_type = local_types[type_name]
			var can_clear = false
			var im = module.imports
			for(var i = 0, l = im.length; i < l;i++){
				var type
				var types = im[i].types
				if(types && (type = types[type_name])){
					can_clear = true
					break
				}
			}
			blob.local_types[type_name] = can_clear?1:this.typeCopy(in_type)
		}

		// parser cache
		var parser_cache = module.parser_cache
		for(var cache_node in parser_cache){
			blob.parser_cache[cache_node] = this.Clean.run(parser_cache[cache_node])
		}
		// imports
		for(var i = 0;i<module.imports.length;i++){
			blob.imports.push(module.imports[i].name)
		}
		// exports
		for(var export_name in module.exports){
			blob.exports[export_name] = 1
		}

		// defines
		for(var define_name in module.defines){
			blob.defines[define_name] = this.Clean.run(module.defines[define_name])
		}

		// macros
		for(var macro_name in module.macros){
			blob.macros[macro_name] = this.Clean.run(module.macros[macro_name])
		}
		var json =  JSON.stringify(blob)
		return json
	}

	this.deserializeModule = function(module_name, json_blob){
		var dt = Date.now()
		var module = ONE.__modules__[module_name] = JSON.parse(json_blob)
		ONE.total_deserialize += Date.now() - dt
		// lets resolve imports
		for(var i = 0;i<module.imports.length;i++){
			var other_name = module.imports[i]
			var other = ONE.__modules__[ other_name ]
			if(!other) console.log('import not found '+other_name)
			else module.imports[i] = other
		}
		// resolve the local types
		for(var name in module.local_types){
			var im = module.imports
			for(var i = 0, l = im.length; i < l;i++){
				var type
				var types = im[i].types
				if(types && (type = types[name])){
					module.local_types[name] = type
					break
				}
			}
		}
		var new_defines = Object.create(null)
		// defines
		for(var define_name in module.defines){
			new_defines[define_name] = module.defines[define_name]
		}
		module.defines = new_defines

		// macros
		var new_macros = Object.create(null)
		for(var macro_name in module.macros){
			new_macros[macro_name] = module.macros[macro_name]
		}
		module.macros = new_macros

		// types
		var new_types = Object.create(null)
		for(var type_name in module.types){
			new_types[type_name] = module.types[type_name]
		}
		module.types = new_types
		//console.log(module.types)
		var dt = Date.now()
		module.compiled_function = Function.call(null, '__module__', module.generated_js)(module)
		ONE.total_compile += Date.now() - dt
		//console.log(module.compiled_function)
		//console.log(module.name, module)
		return module
	}

	// im sure this is slow, but who cares.
	//Error.stackTraceLimit=Infinity 
	//Error.prepareStackTrace = function( err, stack ){
	//	return stack
	//}

	// do a callstack trace including all file/line number info of all running code
	// including template evals
	this.trace = function(){
		return
		var stack = new Error().stack
		for(var i = 0;i<stack.length;i++){
			//console.log(stack[i].getFunction(),stack[i].getLineNumber())
			console.log(stack[i].getThis())
		}
	}
	parser_live.Node = parser_normal.Node = Object.create(null)

	// AST node
	this.AST = this.Base.extend(function(outer){

		this._ast_ = 1

		// AST structure definition
		// 0 is value
		// 1 is node
		// 2 is array
		// 3 is array of [ { key:1, value:1, kind:0, short:0 } ]

		this.Structure = {
			Program:{ steps:2 },
			Empty:{},

			Id: { name:0, flag:0, typing:1 },
			Value: { value:0, raw:0, kind:0, multi:0 },
			This: { },

			Array: { elems:2 },
			Object: { keys:3 },
			Index: { object:1, index:1 },
			Key: { object:1, key:1, exist:0 },
			ThisCall: { object:1, key:1 },

			Block:{ steps:2 },
			List: { items:2 },
			Comprehension:{ for:1, expr:1 },
			Template: { chain:2 },
			Break: { label:1 },
			Continue: { label:1 },
			Label: { label:1, body:1 },

			If: { test:1, then:1, else:1, postfix:0, compr:0 },
			Switch: { on:1, cases:2 },
			Case: { test:1, steps:2 },

			Throw: { arg:1 },
			Try: { try:1, arg:1, catch:1, finally:1 },

			While: { test:1, loop:1 },
			DoWhile: { loop:1, test:1 },
			For: { init:1, test:1, update:1, loop:1, compr:0 },
			ForIn: { left:1, right:1, loop:1, compr:0 },
			ForOf: { left:1, right:1, loop:1, compr:0 },
			ForFrom: { right:1, left:1, loop:1, compr:0 }, // right comes first for type inference
			ForTo: { left:1, right:1, loop:1, in:1, compr:0 },

			Var: { defs:2, const:0 },
			TypeVar: { typing:1, defs:2, dim:1 },
			Struct: { id:1, struct:1, base:1},//, defs:2, dim:1 },
			Define: { id:1, value:1 },
			Enum: { id:1, enums:2 },

			Def: { id:1, init:1, dim:1 },

			Function: { id:1, name:1, params:2, rest:1, body:1, arrow:0, gen:0, def:0 },
			Return: { arg:1 },
			Yield: { arg:1 },
			Await: { arg:1 },

			Unary: { op:0, prefix:0, arg:1 },
			Binary: { op:0, prio:0, left:1, right:1 },
			Logic: { op:0, prio:0, left:1, right:1 },
			Assign: { op:0, prio:0, left:1, right:1 },
			Update: { op:0, prio:0, arg:1, prefix:0 },
			Condition: { test:1, then:1, else:1 },

			New: { fn:1, args:2 },
			Call: { fn:1, args:2, extarg:0 },
			Nest: { fn:1, body:1, arrow:0 },

			Class: { id:1, base:1, body:1 },

			Signal: { left:1, right:1 },
			Quote: { quote:1 },
			AssignQuote: { left:1, quote:1 },
			Rest: { id:1, dots:0 },
			Then: { name:1, do:1 },

			Debugger: { },
			With: { object:1, body:1 }
		}

		this.Clone = this.Base.extend("Clone")
		this.Copy = this.Base.extend("Copy")
		this.Walk = this.Base.extend("Walk")
		this.Clean = this.Base.extend("Clean")
		// Generate AST Tools clone and copy
		function ToolGenerator(){
			var ast = this.Structure;

			var ret = ''
			for( var type in ast ){
				var tag = ast[ type ]
				var walk = '\tn.parent = p\nif(this.Pre)this.Pre(n)\n'
				var clean = '\tdelete n.parent\n'+
							'\tdelete n.infer\n'+
							'\tdelete n.infer_struct\n'+
							'\tdelete n.infer_base\n'+
							'\tdelete n.infer_offset\n'+
							'\tdelete n.struct_assign\n'+

							//'\tdelete n.comments\n'+
							'\tdelete n.genstart\n'+
							'\tdelete n.genend\n'+
							'\tdelete n.start\n'+
							'\tdelete n.end\n'

				var copy = '\tc.type = n.type\n'+
							'\tif(n.store) c.store = n.store\n'+
							'\tif(n.parens) c.parens = n.parens\n'+
							'\tif(n.cmu) c.cmu = n.cmu\n'+
							'\tif(n.cmr) c.cmr = n.cmr\n'+
							'\tif(n.cm1) c.cm1 = n.cm1\n'+
							'\tif(n.cm2) c.cm2 = n.cm2\n'+

							'\tc.start = n.start\n'+
							'\tc.end = n.end\n'

				var clone = '\tvar c = {}\n'+
							'\tc._ast_ = 1\n'+
							'\tc.type = n.type\n'+
							'\tif(n.store) c.store = n.store\n'+
							'\tif(n.parens) c.parens = n.parens\n'+
							'\tif(n.cmu) c.cmu = n.cmu\n'+
							'\tif(n.cmr) c.cmr = n.cmr\n'+
							'\tif(n.cm1) c.cm1 = n.cm1\n'+
							'\tif(n.cm2) c.cm2 = n.cm2\n'+
							'\tc.start = n.start\n'+
							'\tc.end = n.end\n'
				var v = 0
				for( var k in tag ){
					var t = tag[ k ]
					
					copy += '\tvar _'+v+'=n.'+k+';if(_'+v+' !== undefined)c.'+k+'=_'+v+'\n'

					if( t === 0){
						clone += '\tvar _'+v+' = n.'+k+'\n\tif(_'+v+' !== undefined)c.'+k+'=_'+v+'\n'
					} 
					else if( t === 1){
						clean += '\tvar _'+v+' = n.'+k+'\n'+
							'\tif(_'+v+') this[_'+v+'.type](_'+v+')\n'

						clone += '\tvar _'+v+' = n.'+k+'\n'+
							'\tif(_'+v+') c.'+k+' = this[_'+v+'.type](_'+v+')\n'

						walk += '\tvar _'+v+' = n.'+k+'\n'+
							'\tif(_'+v+' && this[_'+v+'.type](_'+v+', n)) return 1\n'

					} 
					else if(t === 2){
						clean += '\tvar _'+v+' = n.'+k+'\n'+
							'\tif(_'+v+'){\n'+
								'\t\tvar x\n'+
								'\t\tfor(var len = _'+v+'.length, i = 0; i < len; i++){\n'+
									'\t\t\tx = _'+v+'[i]\n'+
									'\t\t\tif(x) this[x.type](x)\n'+
								'\t\t}\n'+
							'\t}\n'

						clone += '\tvar _'+v+' = n.'+k+'\n'+
							'\tif(_'+v+'){\n'+
								'\t\tvar x, y = []\n'+
								'\t\tfor(var len = _'+v+'.length, i = 0; i < len; i++){\n'+
									'\t\t\tx = _'+v+'[i]\n'+
									'\t\t\tif(x) y[i] = this[x.type](x)\n'+
								'\t\t}\n'+
								'\t\tc.'+k+' = y\n'+
							'\t}\n'

						walk += '\tvar _'+v+' = n.'+k+'\n'+
							'\tif(_'+v+'){\n'+
								'\t\tvar x\n'+
								'\t\tfor(var len = _'+v+'.length, i = 0; i < len; i++){\n'+
									'\t\t\tx = _'+v+'[i]\n'+
									'\t\t\tif(x && this[x.type](x, n)) return 1\n'+
								'\t\t}\n'+
							'\t}\n'

					}
					else if(t === 3){
						clean += '\tvar _'+v+' = n.'+k+'\n'+
								'\tif(_'+v+'){\n'+
								'\t\tfor(var len = _'+v+'.length,i = 0; i < len; i++){\n'+
									'\t\t\tvar x = _'+v+'[i]\n'+
									'\t\t\tthis[x.key.type](x.key, n)\n'+
									'\t\t\tif(x.value) this[x.value.type](x.value)\n'+
								'\t\t}\n'+
							'\t}\n'

						clone += '\tvar _'+v+' = n.'+k+'\n'+
								'\tif(_'+v+'){\n'+
								'\t\tvar x, y = []\n'+
								'\t\tfor(var len = _'+v+'.length,i = 0; i < len; i++){\n'+
									'\t\t\tx = _'+v+'[i], y[i] = {key:this[x.key.type](x.key)}\n'+
									'\t\t\tif(x.value) y[i].value = this[x.value.type](x.value)\n'+
									'\t\t\telse y[i].short = x.short\n'+
								'\t\t}\n'+
								'\t\tc.'+k+'=y\n'+
							'\t}\n'

						walk += '\tvar _'+v+' = n.'+k+'\n'+
								'\tif(_'+v+'){\n'+
								'\t\tfor(var len = _'+v+'.length,i = 0; i < len; i++){\n'+
									'\t\t\tvar x = _'+v+'[i]\n'+
									'\t\t\tif(this[x.key.type](x.key, n)) return 1\n'+
									'\t\t\tif(x.value && this[x.value.type](x.value, n)) return 1\n'+
								'\t\t}\n'+
							'\t}\n'							
					}
					v++
				}
				ret += '\n_clean.'+type+'=function(n){\n' + clean + '\n}\n' 
				ret += '\n_walk.'+type+'=function(n, p){\n' + walk + '\n\tif(this.Post && this.Post(n))return 1\n}\n' 
				ret += '\n_clone.'+type+'=function(n){\n' + clone + '\treturn c\n}\n' 
				ret += '\n_copy.'+type+'=function(n, c){\n'+ copy +'\treturn\n}\n'
			}
			(new Function('_clone', '_copy', '_walk', '_clean', ret))( this.Clone, this.Copy, this.Walk, this.Clean )

			this.Clone.AST = this
			this.Clone.Unary = function( n ){
				var c = Object.create( this.AST )
				c.start = n.start
				c.end = n.end
				c.type = n.type
				c.prefix = n.prefix
				if(n.parens)c.parens = n.parens
				if(n.comments)c.comments = n.comments
				c.op = n.op
				if( n.prefix && n.op == '%'){
					if(n.arg.type !== 'Id') throw new Error('Unknown template & argument type')
					if( this.template ) this.template.push( c )
				}
				c.arg = this[n.arg.type]( n.arg )
				return c
			}
			this.Walk.run = 
			this.Clean.run = function(n){
				this[n.type](n)
				return n
			}
		}
		ToolGenerator.call(this)

		this.getDependencies = function(node){
			return this.DepFinder.start( node )
		}

		this.DepFinder = this.Walk.extend(this, function(outer){
			this.start = function(n){
				this.deps = []
				this[ n.type ]( n )
				return this.deps
			}

			this.Call = function( n, p ){
				outer.Walk.Call.call(this, n, p)
				if(n.fn.name == 'load'){
					var arg = n.args[0]
					if(arg && arg.type == 'Value' && arg.kind == 'string'){
						this.deps.push(arg.value)
					}
				}
			}
			this.TypeVar = function( n, p ){
				if(n.typing.name !== 'import') return
				var defs = n.defs
				for(var i = 0, l = defs.length; i < l; i++){
					var def = defs[i]
					this.deps.push(def.id.name)
				}
			}
		},"DepFinder")

		this.needsParens = function(n, other, isleft){
			var other_t = other.type

			if(other_t == 'Assign' || other_t == 'List' || other_t == 'Condition' || 
				(other_t == 'Binary' || other_t == 'Logic') && other.prio <= n.prio){
				if(other.prio == n.prio && isleft) return false
				return true
			}
		}

		this.clone = function(node, template){
			this.Clone.template = template
			var clone = this.Clone[ node.type ]( node )
			this.Clone.template = undefined
			return clone
		}

		this.IsExpr = {
			Id: 1,
			Value: 1,
			This: 1,

			Array: 1,
			Object: 1,
			Index: 1,
			Key: 1,

			List: 1,

			Function: 1,

			Unary: 1,
			Binary: 1,
			Logic: 1,
			Assign: 1,
			Update: 1,
			Condition: 1,
			Comprehension:1,
			Template:1,

			New: 1,
			Call: 1,
			Nest: 1,

			Quote: 1,
			Path: 1
		}

		this.isExpr = function(node){
			return this.IsExpr[ node.type ]
		}

		this.isKeyChain = function(node){
			while(node){
				if(node.type == 'Id' || node.type == 'This') return node
				if(node.type != 'Key' && node.type != 'Index') return
				node = node.object
			}
			return
		}

		this.toJS = function(node, comments){
			var js = this.ToJS
			js.line = 0
			js.scope = {}
			return js.expand( node )
		}

		this.toString =
		this.toCode = function(node, comments){
			var code = this.ToCode
			code.line = 0
			return code.expand( node )
		}

		// ToCode reserializes the AST to oneJS as is
		this.ToCode = this.Base.extend(this, function(outer){

			this.space = ' '
			this.newline = '\n'
			this.indent = '\t'
			this.depth = ''
			this.line = 0

			this.expand_short_object = 0

			this.store = function( n, value ){
				var ret = value
				if(n.store & 1) ret = ret + '..'
				if(n.store & 2) ret = ret + '!'
				if(n.store & 4) ret = ret + '~'
				return ret
			}
			
			this.probe = function( n, value ){
				return ret				
			}

			this.expand = function( n, parent, type ){ // recursive expansion
				if(type && typeof type !== 'string') throw new Error('type not string')
				if( !n || !n.type ) return ''

				n.parent = parent
				n.genstart = this.line

				if(!this[n.type]) throw new Error('Undefined type in ToCode:' + n.type)

				var ret = this[type || n.type](n)
				n.genend = this.line

				if(n.store) ret = this.store(n, ret)

				return ret
			}

			this.block = function( n, parent, noindent ){ // term split array
				var old_depth = this.depth
				if(!noindent) this.depth += this.indent
				var ret = ''
				for( var i = 0; i < n.length; i++ ){
					var node = n[ i ]
					var blk = this.expand(node, parent)
					if(blk === undefined) throw new Error('ast node ' + node.type + ' returned undefined in block')
					if(blk[0] == '(' || blk[0] == '[') ret += this.depth + ';' + blk
					else ret += this.depth + blk

					if(this.term) ret += this.term

					var ch = ret[ret.length - 1]
					if(ch !== '\n' ){
						ret += this.newline, this.line++
					}
				}
				this.depth = old_depth
				return ret
			}

			this.flat = function( n, parent ){
				var len = n.length
				if(len == 0) return ''
				var ret = ''

				for(var i = 0; i < len; i++){
					if(i) ret += ',' + this.space
					ret += this.expand(n[i], parent)
				}
				return ret
			}

			this.list = function( n, parent ){
				var len = n.length
				if(len == 0) return ''
				var ret = ''
				var split = ',' + this.space

				for(var i = 0; i < len; i++){
					if(ret !== '') ret += split
					ret += this.expand(n[i], parent)
					if(ret[ret.length - 1] == '\n') ret += i == len - 1? this.depth:this.depth+this.indent
				}

				return ret
			}

			this.Program = function( n ){ 
				return this.block(n.steps, n, true)
			}

			this.Empty = function( n ){
				return ''
			}

			this.Id = function( n ){
				var flag = n.flag
				if(flag){
					if(flag === -1) return '..'
					if(flag === 46) return '.' + n.name
					if(flag === 126) return n.name + '~'
					if(flag === 33) return n.name + '!'
					if(flag === 64) return '@' + (n.name!==undefined?n.name:'')
					if(flag === 35) return '#' + (n.name!==undefined?n.name:'')
				}
				if(n.typing) return this.expand(n.typing, n) + ' ' + n.name
				return n.name
			}

			this.Define = function( n ){
				return 'define ' + this.expand(n.id, n) + ' ' + this.expand(n.value, n)
			}

			this.Value = function( n ){
				return n.raw 
			}
			 // string, number, bool
			this.This = function( n ){
				return 'this'
			}

			this.Array = function( n ){
				var ret = '[' +
					this.list( n.elems, n) +
				']'
				return ret
			}

			this.Object = function( n ){ 
				var old_depth = this.depth
				this.depth += this.indent

				var k = n.keys
				var len = k.length
				var ret = '{' + this.space
				var lastcm = ''
				var vc = 0

				for(var i = 0; i < len; i++){
					var prop = k[i]
					if(i) ret += ',' + this.space + lastcm
					lastcm = ''
					var ch = ret[ret.length -1]
					if(ch == '\n') ret += this.depth
					else if(ch == '}') ret +=  this.newline + this.depth
					ret += (prop.key.name || prop.key.raw) 

					if(prop.short === undefined){
						ret += ':' + this.expand(prop.value, n)
					}
					else{
						if(this.expand_short_object){
							ret += ':' + this.resolve(prop.key.name)
						}
					}
				}

				var ch = ret[ ret.length - 1 ]
				if( ch == '\n') ret += old_depth +'}'
				else{
					if( ch == '}' ) ret += this.newline + old_depth + '}'
					else ret += this.space + '}'
				}
				this.depth = old_depth

				return ret
			}

			this.Index = function( n ){
				var obj = n.object
				var object_t = obj.type
				var object = this.expand(obj, n)
				if(object_t !== 'Index' && object_t !== 'Id' && object_t !== 'Key' && object_t !== 'Call' && object_t !== 'This' && object_t !== 'ThisCall')
					object = '(' + object + ')'
				// when do we need parens? if its not a key or block or call
				return object + '[' + this.expand( n.index, n ) + ']'
			}

			this.Key = function( n ){
				var obj = n.object
				var object_t = obj.type
				var object = this.expand(obj, n)
				if(object_t !== 'Index' && object_t !== 'Id' && object_t !== 'Key' && object_t !== 'Call'&& object_t !== 'This' && object_t !== 'ThisCall')
					object = '(' + object + ')'

				return  object + (this.exist?'?.':'.') + this.expand(n.key, n)
			}

			this.ThisCall = function( n ){
				var obj = n.object
				var object_t = obj.type
				var object = this.expand(obj, n)
				if(object_t !== 'Index' && object_t !== 'Id' && object_t !== 'Key' && object_t !== 'Call'&& object_t !== 'This' && object_t !== 'ThisCall')
					object = '(' + object + ')'

				return  object + '::' + this.expand(n.key, n)
			}

			this.Block = function( n ){
				var ret = '{' + this.newline + this.block(n.steps, n) + this.depth + '}'
				return ret
			}

			this.List = function( n ){
				return this.list(n.items, n)
			}

			this.Comprehension = function( n ){
				return '1'
			}

			this.Template = function( n ){
				var ret = '`'
				var chain = n.chain
				var len = chain.length 
				for(var i = 0; i < len; i++){
					var item = chain[i]
					if(item.type == 'Block'){
						if(item.steps.length == 1 && outer.IsExpr[item.steps[0].type]){
							ret += '{' + this.expand(item.steps[0], n) + '}'
						} 
						else ret += this.expand(item, n)
					}
					else {
						if(item.value !== undefined) ret += item.value
					}
				}
				ret += '`'
				return ret
			}

			this.Break = function( n ){
				return 'break'+(n.label?' '+this.expand(n.label, n):'')
			}

			this.Continue = function( n ){
				return 'continue'+(n.label?' '+this.expand(n.label, n):'')
			}

			this.Label = function( n ){
				return this.expand(n.label, n)+':'+this.expand(n.body, n)
			}

			this.If = function( n ) {
				var ret = 'if('
				ret += this.expand( n.test, n )

				if( ret[ret.length - 1] == '\n') ret += this.depth + this.indent
				ret += ')' + this.space + this.expand(n.then, n) 

				if(n.else){
					var ch = ret[ret.length - 1]
					if( ch !== '}' && this.term) ret += this.term
					if( ch !== '\n' ) ret += this.newline
					ret += this.depth + 'else ' + this.expand(n.else, n)
				}

				return ret
			}

			this.Switch = function( n ){
				var ret = 'switch(' + this.expand(n.on, n) + '){'

				ret += this.newline

				var old = this.depth
				this.depth += this.indent				

				var cases = n.cases
				if(cases) for( var i = 0; i < cases.length; i++ ) ret += this.depth + this.expand(cases[i], n)

				this.depth = old
				ret += this.depth + '}'

				return ret
			}

			this.Case = function( n ){
				if(!n.test){
					return 'default:' + (n.steps.length? this.newline+this.block(n.steps, n): this.newline)
				}
				var ret = 'case '

				ret += this.expand(n.test, n) + ':' 
				ret += this.newline

				if(n.steps.length) ret += this.block(n.steps, n)

				return ret
			}

			this.Throw = function( n ){
				return 'throw ' + this.expand(n.arg, n)
			}

			this.Try = function( n ){
				var ret = 'try' + this.expand(n.try, n)
				if(n.catch){
					if(n.arg.type !== 'Id') throw new Error("unsupported catch type")
					var name = n.arg.name 
					var inscope = this.scope[name]
					if(!inscope) this.scope[name] = 1
					ret += 'catch('+name+')'+this.expand(n.catch, n)
					if(!inscope) this.scope[name] = undefined

				} 

				if(n.finally) ret += 'finally' + this.expand(n.finally, n)
				return ret
			}

			this.While = function( n ){
				return 'while(' + this.expand(n.test, n) + ')' + 
					this.expand(n.loop, n)
			}

			this.DoWhile = function( n ){
				return 'do' + this.expand(n.loop, n) + 
					'while(' + this.expand(n.test, n) + ')'
			}

			this.For = function( n ){
				return 'for(' + this.expand(n.init, n)+';'+
						this.expand(n.test, n) + ';' +
						this.expand(n.update, n) + ')' + 
						this.expand(n.loop, n)
			}

			this.ForIn = function( n ){
				return 'for(' + this.expand(n.left, n) + ' in ' +
					this.expand(n.right, n) + ')' + 
					this.expand(n.loop, n)
			}

			this.ForOf = function( n ){

				return 'for(' + this.expand(n.left, n) + ' of ' +
					this.expand(n.right, n) + ')' + 
					this.expand(n.loop, n)
			}

			this.ForFrom = function( n ){
				return 'for(' + this.expand(n.left, n) + ' from ' +
					this.expand(n.right, n) + ')' + 
					this.expand(n.loop, n)
			}

			this.ForTo = function( n ){
				return 'for(' + this.expand(n.left, n) + ' to ' +
					this.expand(n.right, n) + 
					(n.in?' in ' + this.expand(n.in, n):'') + ')' + 
					this.expand(n.loop, n)
			}

			this.Var = function( n ){
				return 'var ' + this.flat(n.defs, n)
			}

			this.TypeVar = function( n ){
				return this.expand(n.typing, n) + ' ' + 
					this.flat(n.defs, n)
			}

			this.Def = function( n ){
				return this.expand(n.id, n) + 
					(n.init ? this.space + '=' + this.space + this.expand(n.init, n) : '')
			}

			this.Struct = function( n ){
				return 'struct ' + this.expand(n.id, n) + this.expand(n.struct, n)
			}

			this.Enum = function( n ){
				return 'enum ' + this.expand( n.id, n) + '{' + this.newline + 
					this.depth + this.indent + this.list(n.enums, n) +'}'
			}

			this.Function = function( n ){
				if(n.arrow){
					var arrow = n.arrow
					// if an arrow has just one Id as arg leave off ( )
					if( !n.name && !n.rest && n.params && n.params.length == 1 && !n.params[0].init && n.params[0].id.type == 'Id' ){
						return this.expand(n.params[0].id, n) + arrow + this.expand(n.body, n)
					}
					var ret = ''
					if(n.name) ret += this.expand(n.name)

					ret += '(' +(n.params?this.list(n.params, n):'') + 
						(n.rest ? ',' + this.space + this.expand(n.rest, n) : '' )+ ')' 
					if(!n.name || n.body.type != 'Block' || arrow != '->') ret += arrow
					ret += this.expand(n.body, n)
					this.cignore = 1
					return ret
				}
				var ret 
				if(n.name) ret = this.expand(n.name)
				else ret = 'function'
				if( n.gen ) ret += '*'
				if( n.id ) ret += ' '+this.expand(n.id, n)
				ret += '('+this.list(n.params, n)
				if( n.rest ) ret += ',' + this.expand(n.rest, n) 
				ret += ')'
				ret += this.expand(n.body, n)
				return ret
			}

			this.Return = function( n ){
				if(!n.arg) return 'return'
				return 'return ' + this.expand(n.arg, n)
			}

			this.Yield = function( n ){
				if(!n.arg) return 'yield'
				return 'yield ' + this.expand(n.arg, n)
			}

			this.Await = function( n ){
				if(!n.arg) return 'await'
				return 'await ' + this.expand(n.arg, n)
			}

			this.Unary = function( n ){
				if(n.arg === undefined){
					console.log(n.toDump())
				}
				var arg = this.expand(n.arg, n)
				var atype = n.arg.type

				if( n.prefix ){
					if(atype == 'Assign' || atype == 'Binary' ||
						atype == 'Logic' || atype == 'Condition')
						arg = '(' + arg + ')'

					if(n.op.length != 1) return n.op + ' ' + arg

					return n.op + arg
				}
				return arg + n.op
			}

			// alright so how are we going to do parens?
			this.Binary = function( n ){
				var left = this.expand(n.left, n)
				var right = this.expand(n.right, n)
				var left_t = n.left.type
				var right_t = n.right.type

				if(outer.needsParens(n, n.left)) left = '(' + left + ')'
				if(outer.needsParens(n, n.right)) right = '(' + right + ')' 

				return left + this.space + n.op + this.space + right
			}

			this.Logic = function( n ){
				var left = this.expand(n.left, n)
				var right = this.expand(n.right, n)
				var left_t = n.left.type
				var right_t = n.right.type

				if(outer.needsParens(n, n.left)) left = '(' + left + ')'
				if(outer.needsParens(n, n.right)) right = '(' + right + ')' 

				return left + this.space + n.op + this.space + right
			}

			this.Assign = function( n ){
				var left = this.expand(n.left, n)
				var right = this.expand(n.right, n)
				return left + this.space + n.op + this.space + right
			}

			this.Update = function( n ){
				if(n.prefix) return n.op + this.expand(n.arg, n)
				return this.expand (n.arg, n) + n.op
			}

			this.Condition = function( n ){
				// if we have a test of logic or binary 
				var test = this.expand(n.test, n)
				var test_t = n.test.type

				if(test_t == 'Assign' || test_t == 'List' || 
					test_t == 'Logic' || test_t == 'Binary') test = '(' + test + ')'

				var else_v = this.expand(n.else, n)
				var else_t = n.else.type
				if(else_t == 'Assign' || else_t == 'List' || 
					else_t == 'Logic' || else_t == 'Binary') else_v = '(' + else_v + ')'

				return test + '?' + 
					this.space + this.expand(n.then, n) + ':' + 
					this.space + else_v
			}

			this.New = function( n ){
				var fn = this.expand(n.fn, n)
				var fn_t = n.fn.type
				if(fn_t == 'List' || fn_t == 'Logic' || fn_t == 'Condition') 
					fn = '(' + fn + ')'
				return 'new ' + fn + '(' + this.list(n.args, n) + ')'
			}

			this.Call = function( n ){
				var fn = this.expand(n.fn, n)
				var fn_t = n.fn.type
				if(fn_t == 'Function' || fn_t == 'List' || fn_t == 'Logic' || fn_t == 'Condition') 
					fn = '(' + fn + ')'
				var arg = ''
				if(n.first_args) arg += this.list(n.first_args, n)
				if(n.args && n.args.length){
					if(arg) arg += ', '
					arg += this.list(n.args, n)
				}
				if(n.last_args){
					if(arg) arg += ', '
					arg += this.list(n.last_args, n)
				}
				return fn + '(' + arg + ')'
			}

			this.Nest = function( n ){
				return this.expand(n.fn, n) + this.expand(n.body, n)
			}

			this.Class = function( n ){
				var ret = 'class ' + n.id.name
				if(n.base) ret += ' extends ' + n.base.name 
				ret += this.expand(n.body, n)
				return ret
			}

			this.Quote = function( n ){
				var ret = ':' + this.expand(n.quote, n)
				return ret
			}

			this.Signal = function( n ){
				var left = this.expand(n.left, n)
				var right = this.expand(n.right, n)
				return left + ':=' + this.space + quote
			}

			this.AssignQuote = function( n ){
				var left = this.expand(n.left, n)
				var quote = this.expand(n.quote, n)
				return left + ':' + this.space + quote
			}
			
			this.Rest = function( n ){
				return '...' + this.expand(n.id, n)
			}

			this.CallBlock = function( n ){
				return this.expand(n.object, n) + this.expand(n.body, n)
			}

			this.Debugger = function( n ){
				return 'debugger'
			}

			this.With = function( n ){
				return 'with(' + this.expand(n.object, n) + ')' + this.expand(n.body, n)
			}
		})

		this.ToEscaped = this.ToCode.extend(this, function(outer){
			
			this.newline = ' \\n\\\n'
			this.indent = '\t'

			this.Key = function( n ){
				return this.expand(n.object, n) + '.' + n.key.name
			}

			this.Id = function( n ){
				// resolve the id against scope, if its in scope we have to flag it
				if(this.scope[n.name]) this.locals[n.name] = 1
				return outer.ToCode.Id.call(this, n)
			}

			this.Unary = function( n ){
				if(n.prefix){
					if(n.op == '%' && this.templates){
						if(n.arg.type != 'Id') throw new Error("Unknown template & variable type")
						this.templates[n.arg.name] = 1
					}
					if(n.op.length != 1)
						return n.op + ' ' + this.expand(n.arg, n)
					return n.op + this.expand(n.arg, n)
				}
				return this.expand(n.arg, n) + n.op
			}

			this.Value = function( n ){
				if(n.kind == 'string' || n.kind == 'regexp'){
					// escape ' and "
					return n.raw.replace(/"/g,'\\"').replace(/'/g,"\\'")
				}
				return n.raw
			}
		})

		// TODO update this
		this.ToSignalExpr = this.ToCode.extend(this, function( outer ){
			this.deps = 0

			this.Call = function( n ){
				if( n.fn.type !== 'Id') throw new Error("Dont know how to do non Id call")
				return 'this.' + n.fn.name + '(' + this.list( n.args, n ) + ')'
			}

			this.Id = function( n ){
				// direct ID's
				this.deps.push( null, n.name )
				return 'this.' + n.name+'.valueOf()'
			}

			this.Key = function( n ){
				// reading properties
				var obj =  outer.ToCode.expand(n.object)
				var key = outer.ToCode.expand(n.key)
				// base + key pairs
				this.deps.push(obj, key)
				return 'this.' + obj + '.' + key + '.valueOf()'
			}

			this.Index = function(n){
				throw new Error("Signals dont do index")
			}
		})
    
		this.toDump = function(n, tab){
			if(! n ) var log = true
			n  = n || this
			tab = tab || '-';
			var wr = Array.isArray(n) ? '[ ]' : '' ;
			var ret = (n.type?n.type+'('+n.start+' - '+n.end+')'+wr:'')
            
			var keys = Object.keys(n)
			for( var i = 0;i < keys.length; i++){
				var k = keys[i]
				if(k == '_ast_' || k == 'parent' || k == 'tokens' || k == 'start' || k == 'end' || k == 'module' || k == 'locals'
					|| k == 'loc' || k == 'type' || k == 'pthis' || k=='source') continue;
				var v = n[k]
				// decode type inference a bit
				if(k == 'cmu' || k == 'cmr' || k == 'cm1' || k == 'cm2'){
					ret += '\n'+tab+k+'('+n.type+'):['
					for(var c = 0; c < v.length; c++){
						ret += (c?',':'') + (typeof v[c] == 'string' ? '"'+v[c]+'"' : v[c])
					}
					ret += ']'
					continue
				}
				if(k == 'infer'){
					ret += '\n' + tab + k + ':' + (v?v.name:'undefined')
					continue
				}
				 
				if(typeof v !== 'function'){
					if(typeof v == 'object'){
						if(v !== null && Object.keys(v).length > 0)
							ret += '\n' + tab + k+':' + this.toDump(v, tab + '-')
					} else {
						if(v !== false) ret += '\n' + tab + k+':' + v
					}
				}
			}
			return ret
		}
		ONE.genjs_.call(this)
		ONE.genjs_compat_()
	}, "AST")
	
	return this
}

ONE.color_ = function(){

	this.color_wikipedia = {
		acidgreen:0xB0BF1A,aero:0x7CB9E8,aeroblue:0xC9FFE5,africanviolet:0xB284BE,airforceblueraf:0x5D8AA8,airforceblueusaf:0x00308F,
		airsuperiorityblue:0x72A0C1,alabamacrimson:0xAF002A,aliceblue:0xF0F8FF,alizarincrimson:0xE32636,alloyorange:0xC46210,
		almond:0xEFDECD,amaranth:0xE52B50,amaranthpink:0xF19CBB,amaranthpurple:0xAB274F,amaranthred:0xD3212D,amazon:0x3B7A57,
		amber:0xFFBF00,ambersaeece:0xFF7E00,americanrose:0xFF033E,amethyst:0x9966CC,androidgreen:0xA4C639,antiflashwhite:0xF2F3F4,
		antiquebrass:0xCD9575,antiquebronze:0x665D1E,antiquefuchsia:0x915C83,antiqueruby:0x841B2D,antiquewhite:0xFAEBD7,aoenglish:0x008000,
		applegreen:0x8DB600,apricot:0xFBCEB1,aqua:0x00FFFF,aquamarine:0x7FFFD4,armygreen:0x4B5320,artichoke:0x8F9779,arylideyellow:0xE9D66B,
		ashgrey:0xB2BEB5,asparagus:0x87A96B,atomictangerine:0xFF9966,auburn:0xA52A2A,aureolin:0xFDEE00,aurometalsaurus:0x6E7F80,
		avocado:0x568203,azure:0x007FFF,azurecolor:0xF0FFFF,azuremist:0xF0FFFF,azureishwhite:0xDBE9F4,babyblue:0x89CFF0,babyblueeyes:0xA1CAF1,
		babypink:0xF4C2C2,babypowder:0xFEFEFA,bakermillerpink:0xFF91AF,ballblue:0x21ABCD,bananamania:0xFAE7B5,bananayellow:0xFFE135,
		bangladeshgreen:0x006A4E,barbiepink:0xE0218A,barnred:0x7C0A02,battleshipgrey:0x848482,bazaar:0x98777B,beaublue:0xBCD4E6,
		beaver:0x9F8170,beige:0xF5F5DC,bdazzledblue:0x2E5894,bigdiporuby:0x9C2542,bisque:0xFFE4C4,bistre:0x3D2B1F,bistrebrown:0x967117,
		bitterlemon:0xCAE00D,bitterlime:0xBFFF00,bittersweet:0xFE6F5E,bittersweetshimmer:0xBF4F51,black:0x000000,blackbean:0x3D0C02,
		blackleatherjacket:0x253529,blackolive:0x3B3C36,blanchedalmond:0xFFEBCD,blastoffbronze:0xA57164,bleudefrance:0x318CE7,
		blizzardblue:0xACE5EE,blond:0xFAF0BE,blue:0x0000FF,bluecrayola:0x1F75FE,bluemunsell:0x0093AF,bluencs:0x0087BD,bluepantone:0x0018A8,
		bluepigment:0x333399,blueryb:0x0247FE,bluebell:0xA2A2D0,bluegray:0x6699CC,bluegreen:0x0D98BA,bluemagentaviolet:0x553592,
		bluesapphire:0x126180,blueviolet:0x8A2BE2,blueyonder:0x5072A7,blueberry:0x4F86F7,bluebonnet:0x1C1CF0,blush:0xDE5D83,
		bole:0x79443B,bondiblue:0x0095B6,bone:0xE3DAC9,bostonuniversityred:0xCC0000,bottlegreen:0x006A4E,boysenberry:0x873260,
		brandeisblue:0x0070FF,brass:0xB5A642,brickred:0xCB4154,brightcerulean:0x1DACD6,brightgreen:0x66FF00,brightlavender:0xBF94E4,
		brightlilac:0xD891EF,brightmaroon:0xC32148,brightnavyblue:0x1974D2,brightpink:0xFF007F,brightturquoise:0x08E8DE,brightube:0xD19FE8,
		brilliantazure:0x3399FF,brilliantlavender:0xF4BBFF,brilliantrose:0xFF55A3,brinkpink:0xFB607F,britishracinggreen:0x004225,
		bronze:0xCD7F32,bronzeyellow:0x737000,browntraditional:0x964B00,brown:0xA52A2A,brownnose:0x6B4423,brunswickgreen:0x1B4D3E,
		bubblegum:0xFFC1CC,bubbles:0xE7FEFF,buff:0xF0DC82,budgreen:0x7BB661,bulgarianrose:0x480607,burgundy:0x800020,burlywood:0xDEB887,
		burntorange:0xCC5500,burntsienna:0xE97451,burntumber:0x8A3324,byzantine:0xBD33A4,byzantium:0x702963,cadet:0x536872,
		cadetblue:0x5F9EA0,cadetgrey:0x91A3B0,cadmiumgreen:0x006B3C,cadmiumorange:0xED872D,cadmiumred:0xE30022,cadmiumyellow:0xFFF600,
		cafeaulait:0xA67B5B,cafenoir:0x4B3621,calpolypomonagreen:0x1E4D2B,cambridgeblue:0xA3C1AD,camel:0xC19A6B,cameopink:0xEFBBCC,
		camouflagegreen:0x78866B,canaryyellow:0xFFEF00,candyapplered:0xFF0800,candypink:0xE4717A,capri:0x00BFFF,caputmortuum:0x592720,
		cardinal:0xC41E3A,caribbeangreen:0x00CC99,carmine:0x960018,carminemp:0xD70040,carminepink:0xEB4C42,carminered:0xFF0038,
		carnationpink:0xFFA6C9,carnelian:0xB31B1B,carolinablue:0x56A0D3,carrotorange:0xED9121,castletongreen:0x00563F,catalinablue:0x062A78,
		catawba:0x703642,cedarchest:0xC95A49,ceil:0x92A1CF,celadon:0xACE1AF,celadonblue:0x007BA7,celadongreen:0x2F847C,celeste:0xB2FFFF,
		celestialblue:0x4997D0,cerise:0xDE3163,cerisepink:0xEC3B83,cerulean:0x007BA7,ceruleanblue:0x2A52BE,ceruleanfrost:0x6D9BC3,
		cgblue:0x007AA5,cgred:0xE03C31,chamoisee:0xA0785A,champagne:0xF7E7CE,charcoal:0x36454F,charlestongreen:0x232B2B,charmpink:0xE68FAC,
		chartreusetraditional:0xDFFF00,chartreuse:0x7FFF00,cherry:0xDE3163,cherryblossompink:0xFFB7C5,chestnut:0x954535,chinapink:0xDE6FA1,
		chinarose:0xA8516E,chinesered:0xAA381E,chineseviolet:0x856088,chocolatetraditional:0x7B3F00,chocolate:0xD2691E,chromeyellow:0xFFA700,
		cinereous:0x98817B,cinnabar:0xE34234,cinnamon:0xD2691E,citrine:0xE4D00A,citron:0x9FA91F,claret:0x7F1734,classicrose:0xFBCCE7,
		cobalt:0x0047AB,cocoabrown:0xD2691E,coconut:0x965A3E,coffee:0x6F4E37,columbiablue:0xC4D8E2,congopink:0xF88379,coolblack:0x000000,
		coolgrey:0x8C92AC,copper:0xB87333,coppercrayola:0xDA8A67,copperpenny:0xAD6F69,copperred:0xCB6D51,copperrose:0x996666,
		coquelicot:0xFF3800,coral:0xFF7F50,coralpink:0xF88379,coralred:0xFF4040,cordovan:0x893F45,corn:0xFBEC5D,cornellred:0xB31B1B,
		cornflowerblue:0x6495ED,cornsilk:0xFFF8DC,cosmiclatte:0xFFF8E7,coyotebrown:0x81613e,cottoncandy:0xFFBCD9,cream:0xFFFDD0,
		crimson:0xDC143C,crimsonglory:0xBE0032,crimsonred:0x990000,cyan:0x00FFFF,cyanazure:0x4E82b4,cyancobaltblue:0x28589C,
		cyancornflowerblue:0x188BC2,cyanprocess:0x00B7EB,cybergrape:0x58427C,cyberyellow:0xFFD300,daffodil:0xFFFF31,dandelion:0xF0E130,
		darkblue:0x00008B,darkbluegray:0x666699,darkbrown:0x654321,darkbyzantium:0x5D3954,darkcandyapplered:0xA40000,darkcerulean:0x08457E,
		darkchestnut:0x986960,darkcoral:0xCD5B45,darkcyan:0x008B8B,darkelectricblue:0x536878,darkgoldenrod:0xB8860B,darkgrayx11:0xA9A9A9,
		darkgreen:0x013220,darkgreenx11:0x006400,darkimperialblue:0x00416A,darkjunglegreen:0x1A2421,darkkhaki:0xBDB76B,darklava:0x483C32,
		darklavender:0x734F96,darkliver:0x534B4F,darkliverhorses:0x543D37,darkmagenta:0x8B008B,darkmediumgray:0xA9A9A9,darkmidnightblue:0x003366,
		darkmossgreen:0x4A5D23,darkolivegreen:0x556B2F,darkorange:0xFF8C00,darkorchid:0x9932CC,darkpastelblue:0x779ECB,darkpastelgreen:0x03C03C,
		darkpastelpurple:0x966FD6,darkpastelred:0xC23B22,darkpink:0xE75480,darkpowderblue:0x003399,darkpuce:0x4F3A3C,darkraspberry:0x872657,
		darkred:0x8B0000,darksalmon:0xE9967A,darkscarlet:0x560319,darkseagreen:0x8FBC8F,darksienna:0x3C1414,darkskyblue:0x8CBED6,
		darkslateblue:0x483D8B,darkslategray:0x2F4F4F,darkspringgreen:0x177245,darktan:0x918151,darktangerine:0xFFA812,darktaupe:0x483C32,
		darkterracotta:0xCC4E5C,darkturquoise:0x00CED1,darkvanilla:0xD1BEA8,darkviolet:0x9400D3,darkyellow:0x9B870C,dartmouthgreen:0x00703C,
		davysgrey:0x555555,debianred:0xD70A53,deepcarmine:0xA9203E,deepcarminepink:0xEF3038,deepcarrotorange:0xE9692C,deepcerise:0xDA3287,
		deepchampagne:0xFAD6A5,deepchestnut:0xB94E48,deepcoffee:0x704241,deepfuchsia:0xC154C1,deepgreen:0x056608,deepgreencyanturquoise:0x0E7C61,
		deepjunglegreen:0x004B49,deeplemon:0xF5C71A,deeplilac:0x9955BB,deepmagenta:0xCC00CC,deepmauve:0xD473D4,deepmossgreen:0x355E3B,
		deeppeach:0xFFCBA4,deeppink:0xFF1493,deeppuce:0xA95C68,deepruby:0x843F5B,deepsaffron:0xFF9933,deepskyblue:0x00BFFF,
		deepspacesparkle:0x4A646C,deepspringbud:0x556B2F,deeptaupe:0x7E5E60,deeptuscanred:0x66424D,deer:0xBA8759,denim:0x1560BD,
		desaturatedcyan:0x669999,desert:0xC19A6B,desertsand:0xEDC9AF,desire:0xEA3C53,diamond:0xB9F2FF,dimgray:0x696969,dirt:0x9B7653,
		dodgerblue:0x1E90FF,dogwoodrose:0xD71868,dollarbill:0x85BB65,donkeybrown:0x664C28,drab:0x967117,dukeblue:0x00009C,duststorm:0xE5CCC9,
		dutchwhite:0xEFDFBB,earthyellow:0xE1A95F,ebony:0x555D50,ecru:0xC2B280,eerieblack:0x1B1B1B,eggplant:0x614051,eggshell:0xF0EAD6,
		egyptianblue:0x1034A6,electricblue:0x7DF9FF,electriccrimson:0xFF003F,electriccyan:0x00FFFF,electricgreen:0x00FF00,electricindigo:0x6F00FF,
		electriclavender:0xF4BBFF,electriclime:0xCCFF00,electricpurple:0xBF00FF,electricultramarine:0x3F00FF,electricviolet:0x8F00FF,
		electricyellow:0xFFFF33,emerald:0x50C878,eminence:0x6C3082,englishgreen:0x1B4D3E,englishlavender:0xB48395,englishred:0xAB4B52,
		englishviolet:0x563C5C,etonblue:0x96C8A2,eucalyptus:0x44D7A8,fallow:0xC19A6B,falured:0x801818,fandango:0xB53389,fandangopink:0xDE5285,
		fashionfuchsia:0xF400A1,fawn:0xE5AA70,feldgrau:0x4D5D53,feldspar:0xFDD5B1,ferngreen:0x4F7942,ferrarired:0xFF2800,fielddrab:0x6C541E,
		firebrick:0xB22222,fireenginered:0xCE2029,flame:0xE25822,flamingopink:0xFC8EAC,flattery:0x6B4423,flavescent:0xF7E98E,
		flax:0xEEDC82,flirt:0xA2006D,floralwhite:0xFFFAF0,fluorescentorange:0xFFBF00,fluorescentpink:0xFF1493,fluorescentyellow:0xCCFF00,
		folly:0xFF004F,forestgreentraditional:0x014421,forestgreen:0x228B22,frenchbeige:0xA67B5B,frenchbistre:0x856D4D,frenchblue:0x0072BB,
		frenchfuchsia:0xFD3F92,frenchlilac:0x86608E,frenchlime:0x9EFD38,frenchmauve:0xD473D4,frenchpink:0xFD6C9E,frenchplum:0x811453,
		frenchpuce:0x4E1609,frenchraspberry:0xC72C48,frenchrose:0xF64A8A,frenchskyblue:0x77B5FE,frenchviolet:0x8806CE,frenchwine:0xAC1E44,
		freshair:0xA6E7FF,fuchsia:0xFF00FF,fuchsiacrayola:0xC154C1,fuchsiapink:0xFF77FF,fuchsiapurple:0xCC397B,fuchsiarose:0xC74375,
		fulvous:0xE48400,fuzzywuzzy:0xCC6666,gainsboro:0xDCDCDC,gamboge:0xE49B0F,gambogeorangebrown:0x996600,genericviridian:0x007F66,
		ghostwhite:0xF8F8FF,giantsorange:0xFE5A1D,ginger:0xB06500,glaucous:0x6082B6,glitter:0xE6E8FA,gogreen:0x00AB66,goldmetallic:0xD4AF37,
		goldgolden:0xFFD700,goldfusion:0x85754E,goldenbrown:0x996515,goldenpoppy:0xFCC200,goldenyellow:0xFFDF00,goldenrod:0xDAA520,
		grannysmithapple:0xA8E4A0,grape:0x6F2DA8,gray:0x808080,grayx11:0xBEBEBE,grayasparagus:0x465945,
		grayblue:0x8C92AC,greencolorwheelx11green:0x00FF00,greencrayola:0x1CAC78,green:0x008000,greenmunsell:0x00A877,
		greenncs:0x009F6B,greenpantone:0x00AD43,greenpigment:0x00A550,greenryb:0x66B032,greenyellow:0xADFF2F,grizzly:0x885818,
		grullo:0xA99A86,guppiegreen:0x00FF7F,halayaube:0x663854,hanblue:0x446CCF,hanpurple:0x5218FA,hansayellow:0xE9D66B,harlequin:0x3FFF00,
		harlequingreen:0x46CB18,harvardcrimson:0xC90016,harvestgold:0xDA9100,heartgold:0x808000,heliotrope:0xDF73FF,heliotropegray:0xAA98A9,
		heliotropemagenta:0xAA00BB,hollywoodcerise:0xF400A1,honeydew:0xF0FFF0,honolulublue:0x006DB0,hookersgreen:0x49796B,hotmagenta:0xFF1DCE,
		hotpink:0xFF69B4,huntergreen:0x355E3B,iceberg:0x71A6D2,icterine:0xFCF75E,illuminatingemerald:0x319177,imperial:0x602F6B,
		imperialblue:0x002395,imperialpurple:0x66023C,imperialred:0xED2939,inchworm:0xB2EC5D,independence:0x4C516D,indiagreen:0x138808,
		indianred:0xCD5C5C,indianyellow:0xE3A857,indigo:0x6F00FF,indigodye:0x091F92,indigo:0x4B0082,internationalkleinblue:0x002FA7,
		internationalorangeaerospace:0xFF4F00,internationalorangeengineering:0xBA160C,internationalorangegoldengatebridge:0xC0362C,
		iris:0x5A4FCF,irresistible:0xB3446C,isabelline:0xF4F0EC,islamicgreen:0x009000,italianskyblue:0xB2FFFF,ivory:0xFFFFF0,
		jade:0x00A86B,japanesecarmine:0x9D2933,japaneseindigo:0x264348,japaneseviolet:0x5B3256,jasmine:0xF8DE7E,jasper:0xD73B3E,
		jazzberryjam:0xA50B5E,jellybean:0xDA614E,jet:0x343434,jonquil:0xF4CA16,jordyblue:0x8AB9F1,junebud:0xBDDA57,junglegreen:0x29AB87,
		kellygreen:0x4CBB17,kenyancopper:0x7C1C05,keppel:0x3AB09E,khaki:0xC3B091,jawad:0xC3B091,lightkhaki:0xF0E68C,
		kobe:0x882D17,kobi:0xE79FC4,kombugreen:0x354230,kucrimson:0xE8000D,lasallegreen:0x087830,languidlavender:0xD6CADD,lapislazuli:0x26619C,
		laserlemon:0xFFFF66,laurelgreen:0xA9BA9D,lava:0xCF1020,lavenderfloral:0xB57EDC,lavender:0xE6E6FA,lavenderblue:0xCCCCFF,
		lavenderblush:0xFFF0F5,lavendergray:0xC4C3D0,lavenderindigo:0x9457EB,lavendermagenta:0xEE82EE,lavendermist:0xE6E6FA,
		lavenderpink:0xFBAED2,lavenderpurple:0x967BB6,lavenderrose:0xFBA0E3,lawngreen:0x7CFC00,lemon:0xFFF700,lemonchiffon:0xFFFACD,
		lemoncurry:0xCCA01D,lemonglacier:0xFDFF00,lemonlime:0xE3FF00,lemonmeringue:0xF6EABE,lemonyellow:0xFFF44F,lenurple:0xBA93D8,
		licorice:0x1A1110,liberty:0x545AA7,lightapricot:0xFDD5B1,lightblue:0xADD8E6,lightbrown:0xB5651D,lightcarminepink:0xE66771,
		lightcoral:0xF08080,lightcornflowerblue:0x93CCEA,lightcrimson:0xF56991,lightcyan:0xE0FFFF,lightdeeppink:0xFF5CCD,lightfrenchbeige:0xC8AD7F,
		lightfuchsiapink:0xF984EF,lightgoldenrodyellow:0xFAFAD2,lightgray:0xD3D3D3,lightgrayishmagenta:0xCC99CC,lightgreen:0x90EE90,
		lighthotpink:0xFFB3DE,lightkhaki:0xF0E68C,lightmediumorchid:0xD39BCB,lightmossgreen:0xADDFAD,lightorchid:0xE6A8D7,lightpastelpurple:0xB19CD9,
		lightpink:0xFFB6C1,lightredochre:0xE97451,lightsalmon:0xFFA07A,lightsalmonpink:0xFF9999,lightseagreen:0x20B2AA,lightskyblue:0x87CEFA,
		lightslategray:0x778899,lightsteelblue:0xB0C4DE,lighttaupe:0xB38B6D,lightthulianpink:0xE68FAC,lightyellow:0xFFFFE0,lilac:0xC8A2C8,
		limecolorwheel:0xBFFF00,limex11green:0x00FF00,limegreen:0x32CD32,limerick:0x9DC209,lincolngreen:0x195905,linen:0xFAF0E6,
		lion:0xC19A6B,liseranpurple:0xDE6FA1,littleboyblue:0x6CA0DC,liver:0x674C47,liverdogs:0xB86D29,liverorgan:0x6C2E1F,liverchestnut:0x987456,
		livid:0x6699CC,lumber:0xFFE4CD,lust:0xE62020,magenta:0xFF00FF,magentacrayola:0xFF55A3,magentadye:0xCA1F7B,magentapantone:0xD0417E,
		magentaprocess:0xFF0090,magentahaze:0x9F4576,magentapink:0xCC338B,magicmint:0xAAF0D1,magnolia:0xF8F4FF,mahogany:0xC04000,
		maize:0xFBEC5D,majorelleblue:0x6050DC,malachite:0x0BDA51,manatee:0x979AAA,mangotango:0xFF8243,mantis:0x74C365,mardigras:0x880085,
		marooncrayola:0xC32148,maroon:0x800000,maroonx11:0xB03060,mauve:0xE0B0FF,mauvetaupe:0x915F6D,mauvelous:0xEF98AA,
		maygreen:0x4C9141,mayablue:0x73C2FB,meatbrown:0xE5B73B,mediumaquamarine:0x66DDAA,mediumblue:0x0000CD,mediumcandyapplered:0xE2062C,
		mediumcarmine:0xAF4035,mediumchampagne:0xF3E5AB,mediumelectricblue:0x035096,mediumjunglegreen:0x1C352D,mediumlavendermagenta:0xDDA0DD,
		mediumorchid:0xBA55D3,mediumpersianblue:0x0067A5,mediumpurple:0x9370DB,mediumredviolet:0xBB3385,mediumruby:0xAA4069,
		mediumseagreen:0x3CB371,mediumskyblue:0x80DAEB,mediumslateblue:0x7B68EE,mediumspringbud:0xC9DC87,mediumspringgreen:0x00FA9A,
		mediumtaupe:0x674C47,mediumturquoise:0x48D1CC,mediumtuscanred:0x79443B,mediumvermilion:0xD9603B,mediumvioletred:0xC71585,
		mellowapricot:0xF8B878,mellowyellow:0xF8DE7E,melon:0xFDBCB4,metallicseaweed:0x0A7E8C,metallicsunburst:0x9C7C38,mexicanpink:0xE4007C,
		midnightblue:0x191970,midnightgreeneaglegreen:0x004953,mikadoyellow:0xFFC40C,mindaro:0xE3F988,mint:0x3EB489,mintcream:0xF5FFFA,
		mintgreen:0x98FF98,mistyrose:0xFFE4E1,moccasin:0xFAEBD7,modebeige:0x967117,moonstoneblue:0x73A9C2,mordantred19:0xAE0C00,
		mossgreen:0x8A9A5B,mountainmeadow:0x30BA8F,mountbattenpink:0x997A8D,msugreen:0x18453B,mughalgreen:0x306030,mulberry:0xC54B8C,
		mustard:0xFFDB58,myrtlegreen:0x317873,nadeshikopink:0xF6ADC6,napiergreen:0x2A8000,naplesyellow:0xFADA5E,navajowhite:0xFFDEAD,
		navy:0x000080,navypurple:0x9457EB,neoncarrot:0xFFA343,neonfuchsia:0xFE4164,neongreen:0x39FF14,newcar:0x214FC6,newyorkpink:0xD7837F,
		nonphotoblue:0xA4DDED,northtexasgreen:0x059033,nyanza:0xE9FFDB,oceanboatblue:0x0077BE,ochre:0xCC7722,officegreen:0x008000,
		oldburgundy:0x43302E,oldgold:0xCFB53B,oldheliotrope:0x563C5C,oldlace:0xFDF5E6,oldlavender:0x796878,oldmauve:0x673147,
		oldmossgreen:0x867E36,oldrose:0xC08081,oldsilver:0x848482,olive:0x808000,olivedrab3:0x6B8E23,olivedrab7:0x3C341F,
		olivine:0x9AB973,onyx:0x353839,operamauve:0xB784A7,orangecolorwheel:0xFF7F00,orangecrayola:0xFF7538,orangepantone:0xFF5800,
		orangeryb:0xFB9902,orange:0xFFA500,orangepeel:0xFF9F00,orangered:0xFF4500,orchid:0xDA70D6,orchidpink:0xF2BDCD,oriolesorange:0xFB4F14,
		otterbrown:0x654321,outerspace:0x414A4C,outrageousorange:0xFF6E4A,oxfordblue:0x002147,oucrimsonred:0x990000,pakistangreen:0x006600,
		palatinateblue:0x273BE2,palatinatepurple:0x682860,paleaqua:0xBCD4E6,paleblue:0xAFEEEE,palebrown:0x987654,palecarmine:0xAF4035,
		palecerulean:0x9BC4E2,palechestnut:0xDDADAF,palecopper:0xDA8A67,palecornflowerblue:0xABCDEF,palegold:0xE6BE8A,palegoldenrod:0xEEE8AA,
		palegreen:0x98FB98,palelavender:0xDCD0FF,palemagenta:0xF984E5,palepink:0xFADADD,paleplum:0xDDA0DD,paleredviolet:0xDB7093,
		palerobineggblue:0x96DED1,palesilver:0xC9C0BB,palespringbud:0xECEBBD,paletaupe:0xBC987E,paleturquoise:0xAFEEEE,paleviolet:0xCC99FF,
		palevioletred:0xDB7093,pansypurple:0x78184A,paoloveronesegreen:0x009B7D,papayawhip:0xFFEFD5,paradisepink:0xE63E62,parisgreen:0x50C878,
		pastelblue:0xAEC6CF,pastelbrown:0x836953,pastelgray:0xCFCFC4,pastelgreen:0x77DD77,pastelmagenta:0xF49AC2,pastelorange:0xFFB347,
		pastelpink:0xDEA5A4,pastelpurple:0xB39EB5,pastelred:0xFF6961,pastelviolet:0xCB99C9,pastelyellow:0xFDFD96,patriarch:0x800080,
		paynesgrey:0x536878,peach:0xFFE5B4,peach:0xFFCBA4,peachorange:0xFFCC99,peachpuff:0xFFDAB9,peachyellow:0xFADFAD,pear:0xD1E231,
		pearl:0xEAE0C8,pearlaqua:0x88D8C0,pearlypurple:0xB768A2,peridot:0xE6E200,periwinkle:0xCCCCFF,persianblue:0x1C39BB,persiangreen:0x00A693,
		persianindigo:0x32127A,persianorange:0xD99058,persianpink:0xF77FBE,persianplum:0x701C1C,persianred:0xCC3333,persianrose:0xFE28A2,
		persimmon:0xEC5800,peru:0xCD853F,phlox:0xDF00FF,phthaloblue:0x000F89,phthalogreen:0x123524,pictonblue:0x45B1E8,pictorialcarmine:0xC30B4E,
		piggypink:0xFDDDE6,pinegreen:0x01796F,pineapple:0x563C5C,pink:0xFFC0CB,pinkpantone:0xD74894,pinklace:0xFFDDF4,pinklavender:0xD8B2D1,
		pinkpearl:0xE7ACCF,pinksherbet:0xF78FA7,pistachio:0x93C572,platinum:0xE5E4E2,plum:0x8E4585,plum:0xDDA0DD,pompandpower:0x86608E,
		popstar:0xBE4F62,portlandorange:0xFF5A36,powderblue:0xB0E0E6,princetonorange:0xF58025,prune:0x701C1C,prussianblue:0x003153,
		psychedelicpurple:0xDF00FF,puce:0xCC8899,pucered:0x722F37,pullmanbrownupsbrown:0x644117,pumpkin:0xFF7518,purple:0x800080,
		purplemunsell:0x9F00C5,purplex11:0xA020F0,purpleheart:0x69359C,purplemountainmajesty:0x9678B6,purplenavy:0x4E5180,purplepizzazz:0xFE4EDA,
		purpletaupe:0x50404D,purpureus:0x9A4EAE,quartz:0x51484F,queenblue:0x436B95,queenpink:0xE8CCD7,quinacridonemagenta:0x8E3A59,
		rackley:0x5D8AA8,radicalred:0xFF355E,rajah:0xFBAB60,raspberry:0xE30B5D,raspberryglace:0x915F6D,raspberrypink:0xE25098,
		raspberryrose:0xB3446C,rawumber:0x826644,razzledazzlerose:0xFF33CC,razzmatazz:0xE3256B,razzmicberry:0x8D4E85,red:0xFF0000,
		redcrayola:0xEE204D,redmunsell:0xF2003C,redncs:0xC40233,redpantone:0xED2939,redpigment:0xED1C24,redryb:0xFE2712,redbrown:0xA52A2A,
		reddevil:0x860111,redorange:0xFF5349,redpurple:0xE40078,redviolet:0xC71585,redwood:0xA45A52,regalia:0x522D80,resolutionblue:0x002387,
		rhythm:0x777696,richblack:0x004040,richbrilliantlavender:0xF1A7FE,richcarmine:0xD70040,richelectricblue:0x0892D0,richlavender:0xA76BCF,
		richlilac:0xB666D2,richmaroon:0xB03060,riflegreen:0x444C38,roastcoffee:0x704241,robineggblue:0x00CCCC,rocketmetallic:0x8A7F80,
		romansilver:0x838996,rose:0xFF007F,rosebonbon:0xF9429E,roseebony:0x674846,rosegold:0xB76E79,rosemadder:0xE32636,rosepink:0xFF66CC,
		rosequartz:0xAA98A9,rosered:0xC21E56,rosetaupe:0x905D5D,rosevale:0xAB4E52,rosewood:0x65000B,rossocorsa:0xD40000,rosybrown:0xBC8F8F,
		royalazure:0x0038A8,royalblue1:0x002366,royalblue2:0x4169E1,royalfuchsia:0xCA2C92,royalpurple:0x7851A9,royalyellow:0xFADA5E,
		ruber:0xCE4676,rubinered:0xD10056,ruby:0xE0115F,rubyred:0x9B111E,ruddy:0xFF0028,ruddybrown:0xBB6528,ruddypink:0xE18E96,
		rufous:0xA81C07,russet:0x80461B,russiangreen:0x679267,russianviolet:0x32174D,rust:0xB7410E,rustyred:0xDA2C43,sacramentostategreen:0x00563F,
		saddlebrown:0x8B4513,safetyorangeblazeorange:0xFF6700,safetyyellow:0xEED202,saffron:0xF4C430,sage:0xBCB88A,stpatricksblue:0x23297A,
		salmon:0xFA8072,salmonpink:0xFF91A4,sand:0xC2B280,sanddune:0x967117,sandstorm:0xECD540,sandybrown:0xF4A460,sandytaupe:0x967117,
		sangria:0x92000A,sapgreen:0x507D2A,sapphire:0x0F52BA,sapphireblue:0x0067A5,satinsheengold:0xCBA135,scarlet:0xFF2400,
		scarlet:0xFD0E35,schausspink:0xFF91AF,schoolbusyellow:0xFFD800,screamingreen:0x76FF7A,seablue:0x006994,seagreen:0x2E8B57,
		sealbrown:0x321414,seashell:0xFFF5EE,selectiveyellow:0xFFBA00,sepia:0x704214,shadow:0x8A795D,shadowblue:0x778BA5,shampoo:0xFFCFF1,
		shamrockgreen:0x009E60,sheengreen:0x8FD400,shimmeringblush:0xD98695,shockingpink:0xFC0FC0,shockingpinkcrayola:0xFF6FFF,
		sienna:0x882D17,silver:0xC0C0C0,silverchalice:0xACACAC,silverlakeblue:0x5D89BA,silverpink:0xC4AEAD,silversand:0xBFC1C2,
		sinopia:0xCB410B,skobeloff:0x007474,skyblue:0x87CEEB,skymagenta:0xCF71AF,slateblue:0x6A5ACD,slategray:0x708090,smaltdarkpowderblue:0x003399,
		smitten:0xC84186,smoke:0x738276,smokyblack:0x100C08,smokytopaz:0x933D41,snow:0xFFFAFA,soap:0xCEC8EF,solidpink:0x893843,
		sonicsilver:0x757575,spartancrimson:0x9E1316,spacecadet:0x1D2951,spanishbistre:0x807532,spanishblue:0x0070B8,spanishcarmine:0xD10047,
		spanishcrimson:0xE51A4C,spanishgray:0x989898,spanishgreen:0x009150,spanishorange:0xE86100,spanishpink:0xF7BFBE,spanishred:0xE60026,
		spanishskyblue:0x00FFFF,spanishviolet:0x4C2882,spanishviridian:0x007F5C,spirodiscoball:0x0FC0FC,springbud:0xA7FC00,springgreen:0x00FF7F,
		starcommandblue:0x007BB8,steelblue:0x4682B4,steelpink:0xCC33CC,stildegrainyellow:0xFADA5E,stizza:0x990000,stormcloud:0x4F666A,
		straw:0xE4D96F,strawberry:0xFC5A8D,sunglow:0xFFCC33,sunray:0xE3AB57,sunset:0xFAD6A5,sunsetorange:0xFD5E53,superpink:0xCF6BA9,
		tan:0xD2B48C,tangelo:0xF94D00,tangerine:0xF28500,tangerineyellow:0xFFCC00,tangopink:0xE4717A,taupe:0x483C32,taupegray:0x8B8589,
		teagreen:0xD0F0C0,tearose:0xF88379,tearose:0xF4C2C2,teal:0x008080,tealblue:0x367588,tealdeer:0x99E6B3,tealgreen:0x00827F,
		telemagenta:0xCF3476,tenne:0xCD5700,terracotta:0xE2725B,thistle:0xD8BFD8,thulianpink:0xDE6FA1,ticklemepink:0xFC89AC,
		tiffanyblue:0x0ABAB5,tigerseye:0xE08D3C,timberwolf:0xDBD7D2,titaniumyellow:0xEEE600,tomato:0xFF6347,toolbox:0x746CC0,
		topaz:0xFFC87C,tractorred:0xFD0E35,trolleygrey:0x808080,tropicalrainforest:0x00755E,trueblue:0x0073CF,tuftsblue:0x417DC1,
		tulip:0xFF878D,tumbleweed:0xDEAA88,tumblr:0x2C4762,turkishrose:0xB57281,turquoise:0x40E0D0,turquoiseblue:0x00FFEF,turquoisegreen:0xA0D6B4,
		tuscan:0xFAD6A5,tuscanbrown:0x6F4E37,tuscanred:0x7C4848,tuscantan:0xA67B5B,tuscany:0xC09999,twilightlavender:0x8A496B,
		tyrianpurple:0x66023C,uablue:0x0033AA,uared:0xD9004C,ube:0x8878C3,uclablue:0x536895,uclagold:0xFFB300,ufogreen:0x3CD070,
		ultramarine:0x120A8F,ultramarineblue:0x4166F5,ultrapink:0xFF6FFF,ultrared:0xFC6C85,umber:0x635147,unbleachedsilk:0xFFDDCA,
		unitednationsblue:0x5B92E5,universityofcaliforniagold:0xB78727,unmellowyellow:0xFFFF66,upforestgreen:0x014421,upmaroon:0x7B1113,
		upsdellred:0xAE2029,urobilin:0xE1AD21,usafablue:0x004F98,usccardinal:0x990000,uscgold:0xFFCC00,universityoftennesseeorange:0xF77F00,
		utahcrimson:0xD3003F,vanilla:0xF3E5AB,vanillaice:0xF38FA9,vegasgold:0xC5B358,venetianred:0xC80815,verdigris:0x43B3AE,
		vermilion:0xE34234,vermilion:0xD9381E,veronica:0xA020F0,verylightblue:0x6666FF,verylightmalachitegreen:0x64E986,verypaleorange:0xFFDFBF,
		verypaleyellow:0xFFFFBF,violet:0x8F00FF,violetcolorwheel:0x7F00FF,violetryb:0x8601AF,violet:0xEE82EE,violetblue:0x324AB2,
		violetred:0xF75394,viridian:0x40826D,viridiangreen:0x009698,vistablue:0x7C9ED9,vividauburn:0x922724,vividburgundy:0x9F1D35,
		vividcerise:0xDA1D81,vividgamboge:0xFF9900,vividmulberry:0xB80CE3,vividorange:0xFF5F00,vividorchid:0xCC00FF,vividraspberry:0xFF006C,
		vividred:0xF70D1A,vividredtangelo:0xDF6124,vividskyblue:0x00CCFF,vividtangelo:0xF07427,vividtangerine:0xFFA089,vividviolet:0x9F00FF,
		vividyellow:0xFFE302,warmblack:0x004242,waterspout:0xA4F4F9,wenge:0x645452,wheat:0xF5DEB3,white:0xFFFFFF,whitesmoke:0xF5F5F5,
		wildblueyonder:0xA2ADD0,wildorchid:0xD470A2,wildstrawberry:0xFF43A4,wildwatermelon:0xFC6C85,willpowerorange:0xFD5800,
		windsortan:0xA75502,wine:0x722F37,winedregs:0x673147,wisteria:0xC9A0DC,woodbrown:0xC19A6B,xanadu:0x738678,yaleblue:0x0F4D92,
		yankeesblue:0x1C2841,yellow:0xFFFF00,yellowcrayola:0xFCE883,yellowmunsell:0xEFCC00,yellowncs:0xFFD300,yellowpantone:0xFEDF00,
		yellowprocess:0xFFEF00,yellowryb:0xFEFE33,yellowgreen:0x9ACD32,yelloworange:0xFFAE42,yellowrose:0xFFF000,zaffre:0x0014A8,
		zinnwalditebrown:0x2C1608,zomp:0x39A78E
	}	

	this.color = function( col, type ) {
		var c = this.color_wikipedia[col] // color LUT
		var a = new Float32Array(3)
		a._t_ = type
		if( c === undefined ){
			// lets parse the color
			var len = col.length
			var i = 0
			c = 0
			while(i<len){
				var ch = col.charCodeAt(i++)
				if(ch >= 48 && ch <= 57){
					c = c << 4
					c += ch - 48
				}
				else if(ch >= 97 && ch <= 102){
					c = c << 4
					c += ch - 87
				}
				else if(ch >= 65 && ch <= 70){
					c = c << 4
					c += ch - 55
				}
				else{ // try to find the color
					col = col.toLowerCase()
					c = this.color_wikipedia[col]
					if(c === undefined) for(var k in this.color_wikipedia){
						if(k.indexOf(col) != -1){
							c = this.color_wikipedia[k]
							// cache it
							this.color_wikipedia[col] = c
							break
						}
					}
					len = 0
				}
			}
			if(len == 3){ 
				a[0] = ((c&0xf00)>>8|(c&0xf00)>>4) /255
				a[1] = ((c&0xf0)|(c&0xf0)>>4) /255
				a[2] = ((c&0xf)|(c&0xf)<<4) /255 
				return a
			}
		}
		a[0] = ((c >> 16)&0xff) /255
		a[1] = ((c >> 8)&0xff) /255
		a[2] = (c&0xff) /255
		return a
	}
}
