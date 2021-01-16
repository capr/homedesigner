/*

	3D model editor widget.
	Written by Cosmin Apreutesei. Public Domain.

*/


let MIND   = 0.001        // min line distance
let MAXD   = 1e4          // max model total distance
let MAXSD  = 0.001 ** 2   // max distance^2 for snapping
let MAXISD = 0.00001 ** 2 // max distance^2 for intersections

// THREE extensions ----------------------------------------------------------

THREE.Line3.closestLineToLine = function(line, clamp, out_line) {

}

// 3D glue -------------------------------------------------------------------

function v2(x, y)      { return new THREE.Vector2(x, y) }
function v3(x, y, z)   { return new THREE.Vector3(x, y, z) }
function line3(p1, p2) { return new THREE.Line3(p1, p2) }
function color(c)      { return new THREE.Color(c) }

function point_array(size) {

	size = size || 64

	let e = {}
	let a

	let len = 0
	function setlen(len1) {
		assert(len1 >= 0)
		if (size < len1) {
			let size1 = nextpow2(len1)
			let a1 = new Float32Array(size1 * 3)
			if (a)
				a1.set(a)
			a = a1
			size = size1
		}
		len = len1
	}

	property(e, 'length', {get: () => len; set: setlen})

	e.get = function(i, out) {
		assert(i >= 0 && i < len)
		if (out) {
			out.x = a[i*3]
			out.y = a[i*3+1]
			out.z = a[i*3+2]
		} else {
			out = v3(a[i*3], a[i*3+1], a[i*3+2])
		}
		out.i = i
		return out
	}

	e.set = function(i, p) {
		assert(i >= 0)
		setlen(max(i+1, len))
		a[i*3  ] = p.x
		a[i*3+1] = p.y
		a[i*3+2] = p.z
	}

	e.add = function(p) {
		e.set(len, p)
		return len-1
	}

	e.insert = function(i, p) {
		assert(false) // TODO
	}

	e.remove = function(i) {
		assert(i >= 0 && i < len)
		if (i+1 < len) {
			assert(false) // TODO
		}
		len--
	}

	e.find = function(p) {
		for (let i = 0; i < len; i++)
		if (a[i*3] == p.x && a[i*3+1] == p.y && a[i*3+2] == p.z)
			return i
	}

	// hit-testing

	// return the closest point to target point with the point index in p.i.
	e.point_hit = function(target_p, max_sd, f) {
		max_sd = max_sd || MAXSD
		let min_sd = 1/0
		let min_p
		let p = v3()
		for (let i = 0; i < len; i++) {
			let sd = e.get(i, p).distanceToSquared(target_p)
			if (sd <= max_sd) {
				if (f)
					f(p, sd)
				if (sd < min_sd) {
					min_sd = sd
					min_p = min_p || v3()
					min_p.copy(p)
					min_p.i = i
				}
			}
		}
		return min_p
	}

	// return the line from closest point to target line
	// with the point index in line.start.i.
	e.line_hit = function(target_line, max_sd, f) {
		max_sd = max_sd || MAXSD
		let min_sd = 1/0
		let int_line = line3()
		let min_int_line
		let p1 = int_line.start
		let p2 = int_line.end
		for (let i = 0; i < len; i++) {
			e.get(i, p1)
			target_line.closestPointToPoint(p1, true, p2)
			let sd = p1.distanceToSquared(p2)
			if (sd <= max_sd) {
				//let t = target_line.closestPointToPointParameter(p1, true)
				//int_line.end = t
				if (f)
					f(int_line, sd)
				if (sd < min_sd) {
					min_sd = sd
					min_int_line = min_int_line || line3()
					min_int_line.start.copy(p1)
					min_int_line.end.copy(p2)
					min_int_line.start.i = i
					//min_int_line.end.t = t
				}
			}
		}
		return min_int_line
	}

	return e
}

function material_db() {

	let e = {}

	e.get_color = function(color) {

	}

	return e
}

function poly_array(e) {

	e = e || {}

	e.points = point_array()
	e.line_pis = [] // [l1p1i, l1p2i, l2p1i, l2p2i, ...]
	e.polys = [] // [[material: m, p1i, p2i, ...], ...]

	e.get_line = function(i, out) {
		let p1i = e.line_pis[i]
		let p2i = e.line_pis[i+1]
		out = out || line3()
		e.points.get(p1i, out.start)
		e.points.get(p2i, out.end)
		return out
	}

	// hit-testing

	e.point_hit_points = function(target_p, max_d, f) {
		return e.points.point_hit(target_p, max_d, f)
	}

	e.line_hit_points = function(target_line, max_d, f) {
		return e.points.line_hit(target_line, max_d, f)
	}

	// return the line from closest line to target point
	// with the line index in line.end.line_i.
	e.point_hit_lines = function(target_p, max_sd, f) {
		max_sd = max_sd || MAXSD
		let min_sd = 1/0
		let line = line3()
		let int_line = line3()
		int_line.start.copy(target_p)
		let min_int_line
		for (let i = 0; i < e.line_pis.length-1; i += 2) {
			line.start = e.points.get(e.line_pis[i])
			line.end   = e.points.get(e.line_pis[i+1])
			line.closestPointToPoint(target_p, true, int_line.end)
			let sd = target_p.distanceToSquared(int_line.end)
			if (sd <= max_sd) {
				int_line.end.line_i = i
				let line_sd = line.distanceSq()
				let cut_sd = line.start.distanceToSquared(int_line.end)
				if (abs(line_sd / 4 - cut_sd) <= MAXSD) { // snap to midpoint
					int_line.end.copy(line.at(.5))
				}
				if (f)
					f(int_line, sd)
				if (sd < min_sd) {
					min_sd = sd
					min_int_line = min_int_line || line3()
					min_int_line.copy(int_line)
					min_int_line.end.line_i = i
				}
			}
		}
		return min_int_line
	}

	// return the line from closest line to target line
	// with the line index in line.end.line_i.
	// if the lines are parallel, line.parallel is set.
	e.line_hit_lines = function(target_line, max_sd, f) {
		max_sd = max_sd || MAXSD
		let min_sd = 1/0
		let line = line3()
		let int_line = line3()
		let min_int_line
		for (let i = 0; i < e.line_pis.length-1; i += 2) {
			line.start = e.points.get(e.line_pis[i])
			line.end   = e.points.get(e.line_pis[i+1])
			let parallel = !target_line.closestLineToLine(line, true, int_line)
			let sd = int_line.start.distanceToSquared(int_line.end)
			if (sd <= max_sd) {
				int_line.parallel = parallel
				int_line.end.line_i = i
				if (f)
					f(int_line, sd)
				if (sd < min_sd) {
					min_sd = sd
					min_int_line = min_int_line || line3()
					min_int_line.copy(int_line)
					min_int_line.end.line_i = i
					min_int_line.parallel = int_line.parallel
				}
			}
		}
		return min_int_line
	}

	// line drawing in 3 stages: start, snap, add.

	e.start_line = function(p) {
		let p = e.points.point_hit(p)
		return line3(p, p)
	}

	e.snap_line_end = function(line, ref_p) {
		line.end.i = null
		line.end.line_i = null

		// snap line end to existing points.
		let int_p = e.point_hit_points(line.end)
		if (int_p) {
			line.end = int_p
			return
		}

		// snap line end to existing lines.
		let int_line = e.point_hit_lines(line.end)
		if (int_line) {
			line.end = int_line.end
			return
		}

		// snap line to existing points preserving length.
		let int_line = e.line_hit_points(line)
		if (int_line) {
			let d = line.distance()
			let d1 = line.start.distanceTo(int_line.start)
			line.end = int_line.start
			line.end = line.at(d / d1)
		}

		if (ref_p) {
			// TODO: snap to axes and to ref point.
		}

		// snap line to axes preserving length.
		// TODO:

	}

	e.add_line = function(line) {

		let p1 = line.start
		let p2 = line.end

		let line_ps = [p1, p2] // line segments' points.

		// cut the line into segments at intersections with existing points.
		let line = line3(p1, p2)
		e.line_hit_points(line, MAXISD, function(int_line) {
			let p = int_line.start
			let i = p.i
			if (i !== p1.i && i !== p2.i) { // exclude end points.
				p = p.clone()
				p.i = i
				line_ps.push(p)
			}
		})

		// sort intersection points by their distance relative to p1
		// so that adjacent points form line segments.
		function sort_line_ps() {
			if (line_ps.length)
				line_ps.sort(function(sp1, sp2) {
					let sd1 = p1.distanceToSquared(sp1)
					let sd2 = p1.distanceToSquared(sp2)
					return sd1 < sd2
				})
		}

		sort_line_ps()

		// check if any of the line segments intersect any existing lines.
		// the ones that do must be broken down further, and so must the
		// existing lines that are cut by them.
		let seg = line3()
		let n = line_ps.length-1
		for (let i = 0; i < n; i += 2) {
			seg.start = line_ps[i]
			seg.end   = line_ps[i+1]
			e.line_hit_lines(seg, MAXISD, function(int_line) {
				let p = int_line.end
				let line_i = p.line_i
				p = p.clone()
				p.line_i = line_i
				line_ps.push(p)
			})
		}

		// create missing points.
		for (let p of line_ps)
			if (p.i == null)
				p.i = e.points.add(p)

		// create line segments.
		for (let i = 0; i < line_ps.length-1; i += 2) {
			let p1i = line_ps[i].i
			let p2i = line_ps[i].i
			e.line_pis.push(p1i, p2i)
		}

		// cut intersecting lines in two.
		for (let p of line_ps) {
			if (p.line_i != null) {
				let p1i = e.line_pis[p.line_i  ]
				let p2i = e.line_pis[p.line_i+1]
				let pmi = p.i
				e.line_pis[p.line_i  ] = p1i
				e.line_pis[p.line_i+1] = pmi
				e.line_pis.push(pmi, p2i)
			}
		}

		//

	}

	e.remove_line = function(line_i) {
		//
	}

	e.move_line = function(line_i, rel_p) {
		//
	}

	e.move_point = function(p_i, rel_p) {
		//
	}

	return e
}


(function() {

// graphics elements ---------------------------------------------------------

function axis(x, y, z, color, dashed) {
	let material = dashed
		? new THREE.LineDashedMaterial({color: color, scale: 100, dashSize: 1, gapSize: 1})
		: new THREE.LineBasicMaterial({color: color})
	let geometry = new THREE.BufferGeometry().setFromPoints([
		v3(  0,  0,  0),
		v3(  x,  y,  z),
	])
	let line = new THREE.Line(geometry, material)
	line.computeLineDistances()
	return line
}

function axes() {
	let M = MAXD
	return [
		axis( 0,  0, -M, 0x00ff00),
		axis( M,  0,  0, 0xff0000),
		axis( 0,  M,  0, 0x0000ff),
		axis( 0,  0,  M, 0x00ff00, true),
		axis(-M,  0,  0, 0xff0000, true),
		axis( 0, -M,  0, 0x0000ff, true),
	]
}

function skydome() {

	let vshader = `
		varying vec3 vWorldPosition;
		void main() {
			vec4 worldPosition = modelMatrix * vec4(position, 1.0);
			vWorldPosition = worldPosition.xyz;
			gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
		}

	`

	let fshader = `
		uniform vec3 topColor;
		uniform vec3 bottomColor;
		uniform float offset;
		uniform float exponent;
		varying vec3 vWorldPosition;
		void main() {
			float h = normalize(vWorldPosition + offset).y;
			gl_FragColor = vec4(mix(bottomColor, topColor, max(pow(max(h, 0.0), exponent), 0.0)), 1.0);
		}
	`

	let uniforms = {
		topColor     : {value: color(0x9999cc)},
		bottomColor  : {value: color(0xffffff)},
		offset       : {value: 33},
		exponent     : {value: .6},
	}

	let geo = new THREE.BoxBufferGeometry(2*MAXD, 2*MAXD, 2*MAXD)
	let mat = new THREE.ShaderMaterial({
		uniforms       : uniforms,
		vertexShader   : vshader,
		fragmentShader : fshader,
		side: THREE.BackSide,
	})
	let e = new THREE.Mesh(geo, mat)
	e.name = 'skydome'
	return e
}

function ground() {
	let geo = new THREE.PlaneBufferGeometry(2*MAXD, 2*MAXD)
	let mat = new THREE.MeshLambertMaterial({color: 0xffffff, depthTest: false})
	mat.color.setHSL(0.09, .6, 0.75)
	let e = new THREE.Mesh(geo, mat)
	e.rotation.x = -PI / 2
	e.receiveShadow = true
	e.name = 'ground'
	return e
}

function hemlight() {
	let e = new THREE.HemisphereLight(0xffffff, 0xffffff, 0.6)
	e.color.setHSL(0.6, 1, 0.6)
	e.groundColor.setHSL(0.095, 1, 0.75)
	e.position.set(0, 50, 0)
	return e
}

function dirlight() {
	let e = new THREE.DirectionalLight(0xffffff, 1)
	e.color.setHSL(0.1, 1, 0.95)
	e.position.set( -1, 1.75, 1)
	e.position.multiplyScalar(30)
	/*
	e.castShadow = true
	e.shadow.mapSize.width = 2048
	e.shadow.mapSize.height = 2048
	let d = 50
	e.shadow.camera.left = - d
	e.shadow.camera.right = d
	e.shadow.camera.top = d
	e.shadow.camera.bottom = - d
	e.shadow.camera.far = 3500;
	e.shadow.bias = - 0.0001;
	*/
	return e
}

// editor --------------------------------------------------------------------

component('x-modeleditor', function(e) {

	// camera, scene, renderer, ground, axes, cursor, model

	e.camera = new THREE.PerspectiveCamera(70, 1, MIND / 100, MAXD * 100)
	e.camera.position.x =  .2
	e.camera.position.y =  .5
	e.camera.position.z =  1.5
	e.camera.rotation.x = -rad(10)
	e.camera.rotation.y = -rad(30)

	e.scene = new THREE.Scene()
	e.scene.add(skydome())
	e.ground = ground()
	e.scene.add(e.ground)
	e.scene.add(...axes())
	e.scene.add(hemlight())
	e.scene.add(dirlight())

	e.renderer = new THREE.WebGLRenderer({antialias: true})
	e.renderer.setPixelRatio(window.devicePixelRatio)
	e.renderer.outputEncoding = THREE.sRGBEncoding
	e.renderer.shadowMap.enabled = true

	e.renderer.setAnimationLoop(function() {
		e.renderer.render(e.scene, e.camera)
	})

	e.canvas = e.renderer.domElement
	e.canvas.attr('tabindex', -1)
	e.canvas.attr('style', 'position: absolute')
	e.add(e.canvas)

	focusable_widget(e, e.canvas)

	e.detect_resize()
	function resized(r) {
		e.camera.aspect = r.w / r.h
		e.camera.updateProjectionMatrix()
		e.renderer.setSize(r.w, r.h)
	}
	e.on('resize', resized)

	e.on('bind', function(on) {
		//if (on) resized(e.rect())
	})

	let cursor
	e.property('cursor', () => cursor, function(name) {
		cursor = name
		e.canvas.style.cursor = 'url(cursor_'+name+'.png), auto'
	})

	// model ------------------------------------------------------------------

	e.components = {} // {name->group}
	e.model = new THREE.Group()
	e.group = e.model // currently editable group within the model

	let helpers = new THREE.Group() // helper geometry for editor state

	function init_group(g) {
		g.points = [] // [x1, y1, z1,...]
		g.line_indices = [] //
		g.vertices = new THREE.BufferAttribute(vertices, 3)
		g.lines_geometry = new THREE.BufferGeometry()
		g.lines_geometry.setIndex(g.line_indices)
		g.lines_geometry.setAttribute('position', g.vertices)
		g.lines = new THREE.Lines(g.lines_geometry, g.lines_material)

		g.faces_geometry = new THREE.BufferGeometry()
		g.faces = new THREE.Mesh(g.faces_geometry, g.faces_material)
	}

	init_group(e.group)

	// tools ---------------------------------------------------------------------

	let tools = {}

	tools.orbit = {}

	tools.orbit.bind = function(e, on) {
		if (on && !e.controls) {
			e.controls = new THREE.OrbitControls(e.camera, e.canvas)
			e.controls.minDistance = MIND * 10
			e.controls.maxDistance = MAXD / 100
		}
		e.controls.enabled = on
	}

	tools.orbit.pointermove = function(e) {
		e.controls.update()
	}

	tools.line = {}

	tools.line.pointermove = function(e, ev, ht) {
		//
	}

	{
		let loader = new THREE.TextureLoader()
		let disc_texture = loader.load('disc.png')

		function dot(p) {
			let geo = new THREE.Geometry()
			geo.vertices.push(p)
			var mat = new THREE.PointsMaterial({
				color: 0xff00ff,
				size: 10,
				sizeAttenuation: false,
				map: disc_texture,
				alphaTest: 0.5,
			})
			return new THREE.Points(geo, mat)
		}
	}

	function line(p, color) {
		let material = new THREE.LineBasicMaterial({color: color || 0})
		let geometry = new THREE.BufferGeometry().setFromPoints([
			v3(  0,  0,  0),
			v3(  x,  y,  z),
		])
		let line = new THREE.Line(geometry, material)
		line.computeLineDistances()
		return line
	}

	tools.line.pointerdown = function(e, ev, ht) {
		let h = ht[0]
		if (h && h.object == e.ground) {

			e.scene.add(dot(h.point))
		}
		return e.capture_pointer_raycast(ev, function(e, ev, ht) {
			print(ht.length)
		})
	}

	tools.pull = {}

	tools.pull.pointerdown = function(ev, ht) {
		//
	}

	tools.move = {}

	let toolkeys = {
		l: 'line',
		p: 'pull',
		o: 'orbit',
		m: 'move',
	}

	// current tool -----------------------------------------------------------

	let tool
	e.property('tool', () => tool, function(name) {
		if (tool && tool.bind)
			tool.bind(e, false)
		tool = assert(tools[name])
		if (tool.bind)
			tool.bind(e, true)
		e.cursor = tool.cursor || name
	})

	e.tool = 'orbit'

	// mouse handling ---------------------------------------------------------

	let raycaster = new THREE.Raycaster()
	let mouse = v2()

	function hittest(mx, my) {
		// calculate mouse position in normalized device coordinates
		// (-1 to +1) for both components
		let r = e.rect()
		let x =  (mx / r.w) * 2 - 1
		let y = -(my / r.h) * 2 + 1
		mouse.x = x
		mouse.y = y
		raycaster.setFromCamera(mouse, e.camera)
		let ht = raycaster.intersectObjects(e.model.children)
		if (!ht.length)
			ht = raycaster.intersectObject(e.ground)
		return ht
	}

	e.on('pointermove', function(ev, mx, my) {
		if (tool.pointermove)
			tool.pointermove(e, ev, hittest(mx, my))
	})

	e.on('pointerdown', function(ev, mx, my) {
		if (tool.pointerdown)
			tool.pointerdown(e, ev, hittest(mx, my))
	})

	e.capture_pointer_raycast = function(ev, move, up) {
		let movewrap = move && function(ev, mx, my) {
			return move(e, ev, hittest(mx, my))
		}
		let upwrap = up && function(ev, mx, my) {
			return up(e, ev, hittest(mx, my))
		}
		return e.capture_pointer(ev, movewrap, upwrap)
	}

	// key handling -----------------------------------------------------------

	e.on('keydown', function(key) {
		let tool = toolkeys[key]
		if (tool)
			e.tool = tool
	})

})

})()
