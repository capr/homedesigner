/*

	3D model editor widget.
	Written by Cosmin Apreutesei. Public Domain.

*/

(function() {

// precision settings --------------------------------------------------------

let MIND   = 0.001         // min line distance
let MAXD   = 1e4           // max model total distance
let SNAPD  = 20            // max pixel distance for snapping
let SELD   = 10            // max pixel distance for selecting
let NEARD  = 0.00001       // max distance for intersections

// primitive construction ----------------------------------------------------

function v2(x, y)        { return new THREE.Vector2(x, y) }
function v3(x, y, z)     { return new THREE.Vector3(x, y, z) }
function line3(p1, p2)   { return new THREE.Line3(p1, p2) }
function color3(c)       { return new THREE.Color(c) }

// disable THREE.js UUID generation ------------------------------------------

{ let n = 0; THREE.Math.generateUUID = () => ++n }

// point-to-screen projection ------------------------------------------------

{
	let p = v3()
	THREE.Vector3.prototype.project_to_canvas = function(camera, out_p) {
		p.copy(this).project(camera)
		out_p.x = round(( p.x + 1) * camera.canvas.width  / 2)
		out_p.y = round((-p.y + 1) * camera.canvas.height / 2)
		out_p.z = 0
		return out_p
	}
}

// line-line intersection ----------------------------------------------------

{
	let mp = v3()
	let mq = v3()
	let qp = v3()
	let rp = v3()
	let rq = v3()
	let p1 = v3()
	let p2 = v3()
	let line = line3(rp, rq)

	// returns the smallest line that connects two (coplanar or skewed) lines.
	// returns null for parallel lines.
	THREE.Line3.prototype.intersectLine = function intersectLine(lq, clamp, out_line) {

		let lp = this
		let p = lp.start
		let q = lq.start
		lp.delta(mp)
		lq.delta(mq)
		qp.copy(p).sub(q)

		let qp_mp = qp.dot(mp)
		let qp_mq = qp.dot(mq)
		let mp_mp = mp.dot(mp)
		let mq_mq = mq.dot(mq)
		let mp_mq = mp.dot(mq)

		let detp = qp_mp * mq_mq - qp_mq * mp_mq
		let detq = qp_mp * mp_mq - qp_mq * mp_mp
		let detm = mp_mq * mp_mq - mq_mq * mp_mp

		if (detm == 0) // lines are parallel
			return

		rp.copy(p).add(mp.multiplyScalar(detp / detm))
		rq.copy(q).add(mq.multiplyScalar(detq / detm))

		if (clamp) {
			p1.copy(lp.end).sub(lp.start)
			p2.copy(rp).sub(lp.start)
			let tp = p2.length() / p1.length() * (p1.dot(p2) > 0 ? 1 : -1)
			p1.copy(lq.end).sub(lq.start)
			p2.copy(rq).sub(lq.start)
			let tq = p2.length() / p1.length() * (p1.dot(p2) > 0 ? 1 : -1)
			if (tp < 0)
				rp.copy(lp.start)
			else if (tp > 1)
				rp.copy(lp.end)
			if (tq < 0)
				rq.copy(lq.start)
			else if (tq > 1)
				rq.copy(lq.end)
		}

		return out_line.copy(line)
	}
}

// region-finding algorithm --------------------------------------------------

// The algorithm below is O(n log n) and it's from the paper:
//   "An optimal algorithm for extracting the regions of a plane graph"
//   X.Y. Jiang and H. Bunke, 1992.

// return a number from the range [0..4] which is monotonic
// in the angle that the input vector makes against the x axis.
function v2_pseudo_angle(dx, dy) {
	let p = dx / (abs(dx) + abs(dy))  // -1..1 increasing with x
	return dy < 0 ? 3 + p : 1 - p     //  2..4 or 0..2 increasing with x
}

{

	let quat = new THREE.Quaternion()
	let xy_normal = v3(0, 0, 1)

	function plane_graph_regions(plane_normal, get_point, lines) {

		quat.setFromUnitVectors(plane_normal, xy_normal)

		// phase 1: find all wedges.

		// step 1+2: make pairs of directed edges from all the edges and compute
		// their angle-to-horizontal so that they can be then sorted by that angle.
		let edges = [] // [[p1i, p2i, angle], ...]
		let n = lines.length / 2
		let p1 = v3()
		let p2 = v3()
		for (let i = 0; i < n; i++) {
			let p1i = lines[2*i+0]
			let p2i = lines[2*i+1]
			get_point(p1i, p1).applyQuaternion(quat)
			get_point(p2i, p2).applyQuaternion(quat)
			edges.push(
				[p1i, p2i, v2_pseudo_angle(p2.x - p1.x, p2.y - p1.y)],
				[p2i, p1i, v2_pseudo_angle(p1.x - p2.x, p1.y - p2.y)])
		}

		// step 3: sort by edges by (p1, angle).
		edges.sort(function(e1, e2) {
			if (e1[0] == e2[0])
				return e1[2] < e2[2] ? -1 : (e1[2] > e2[2] ? 1 : 0)
			else
				return e1[0] < e2[0] ? -1 : 1
		})

		// for (let e of edges) { print('e', e[0]+1, e[1]+1) }

		// step 4: make wedges from edge groups formed by edges with the same p1.
		let wedges = [] // [[p1i, p2i, p3i, used], ...]
		let wedges_first_pi = edges[0][1]
		for (let i = 0; i < edges.length; i++) {
			let edge = edges[i]
			let next_edge = edges[i+1]
			let same_group = next_edge && edge[0] == next_edge[0]
			if (same_group) {
				wedges.push([edge[1], edge[0], next_edge[1], false])
			} else {
				wedges.push([edge[1], edge[0], wedges_first_pi, false])
				wedges_first_pi = next_edge && next_edge[1]
			}
		}

		// for (let w of wedges) { print('w', w[0]+1, w[1]+1, w[2]+1) }

		// phase 2: group wedges into regions.

		// step 1: sort wedges by (p1, p2) so we can binsearch them by the same key.
		wedges.sort(function(w1, w2) {
			if (w1[0] == w2[0])
				return w1[1] < w2[1] ? -1 : (w1[1] > w2[1] ? 1 : 0)
			else
				return w1[0] < w2[0] ? -1 : 1
		})

		// for (let w of wedges) { print('w', w[0]+1, w[1]+1, w[2]+1) }

		// step 2: mark all wedges as unused (already did on construction).
		// step 3, 4, 5: find contiguous wedges and group them into regions.
		// NOTE: the result also contans the outer region which goes clockwise
		// while inner regions go anti-clockwise.
		let regions = [] // [[p1i, p2i, ...], ...]
		let k = [0, 0] // reusable (p1i, p2i) key for binsearch.
		function cmp_wedges(w1, w2) { // binsearch comparator on wedge's (p1i, p2i).
			return w1[0] == w2[0] ? w1[1] < w2[1] : w1[0] < w2[0]
		}
		for (let i = 0; i < wedges.length; i++) {
			let w0 = wedges[i]
			if (w0[3])
				continue // skip wedges marked used
			region = [w0[1]]
			regions.push(region)
			k[0] = w0[1]
			k[1] = w0[2]
			while (1) {
				let i = wedges.binsearch(k, cmp_wedges)
				let w = wedges[i]
				region.push(w[1])
				w[3] = true // mark used so we can skip it
				if (w[1] == w0[0] && w[2] == w0[1]) // cycle complete.
					break
				k[0] = w[1]
				k[1] = w[2]
			}
		}

		// for (let r of regions) { print('r', r.map(i => i+1)) }

		return regions
	}

	function test_plane_graph_regions() {
		let points = [
			v3(0, -5, 0),
			v3(-10, 0, 0), v3(10, 0, 0), v3(-10, 5, 0), v3(10, 5, 0),
			//v3(-5, 1, 0), v3(5,  1, 0), v3(-5, 4, 0), v3(5, 4, 0),
			//v3(0, -1, 0), v3(1, -2, 0),
		]
		let get_point = function(i, out) { out.copy(points[i]); return out }
		let lines  = [0,1, 0,2,  1,2, 1,3, 2,4, 3,4,  ] // 5,6, 5,7, 6,8, 7,8,  0,9, 9,10]
		let rt = plane_graph_regions(v3(0, 0, 1), get_point, lines)
		for (let r of rt) { print(r.map(i => i+1)) }
	}
	// test_plane_graph_regions()

}

// material database ---------------------------------------------------------

function material_db() {

	let e = {}

	e.get_color = function(color) {

	}

	return e
}

// editable polygon meshes ---------------------------------------------------

// Polygon meshes are lists of polygons enclosed and connected by lines
// defined over a common point cloud.

// The editing API implements the direct manipulation UI and is designed to
// perform automatic creation/removal/intersection of points/lines/polygons
// while keeping the model numerically stable and clean. In particular:
// - editing operations never leave duplicate points/lines/polygons.
// - existing points are never moved when adding new geometry.
// - when existing lines are cut, straightness is preserved to best accuracy.

function real_p2p_distance2(p1, p2) { // stub
	return p1.distanceToSquared(p2)
}

function poly_mesh(e) {

	e = e || {}

	e.point_coords = [] // [p1x, p1y, p1z, p2x, ...]
	e.line_pis = [] // [l1p1i, l1p2i, l2p1i, l2p2i, ...]
	e.polys = [] // [[material_id: mi, plane_normal: p, triangle_pis: [t1p1i, ...], p1i, p2i, ...], ...]

	e.points_len = () => e.point_coords.length / 3
	e.lines_len = () => e.line_pis.length / 2

	e.get_point = function(i, out) {
		out = out || v3()
		out.x = e.point_coords[3*i+0]
		out.y = e.point_coords[3*i+1]
		out.z = e.point_coords[3*i+2]
		out.i = i
		return out
	}

	e.get_line = function(i, out) {
		let p1i = e.line_pis[2*i+0]
		let p2i = e.line_pis[2*i+1]
		out = out || line3()
		e.get_point(p1i, out.start)
		e.get_point(p2i, out.end)
		out.i = i
		return out
	}

	let _line = line3()

	e.each_poly_line = function(f, i) {
		let poly = e.polys[i]
		e.get_point(poly[0], _line.start)
		for (let i = 1, n = poly.length; i < n; i++) {
			e.get_point(poly[i], _line.end)
			f(_line)
			_line.start.copy(_line.end)
		}
		e.get_point(poly[0], _line.end)
		f(_line)
	}

	e.each_line = function(f) {
		for (let i = 0, len = e.lines_len(); i < len; i++) {
			e.get_line(i, _line)
			f(_line)
		}
	}

	let xy_normal = v3(0, 0, 1)
	function poly_update_plane(poly) {
		if (poly.valid)
			return
		assert(poly.length >= 3)
		poly.plane = poly.plane || new THREE.Plane()
		let p1 = v3()
		let p2 = v3()
		let p3 = v3()
		let pn = v3()
		for (let i = 2; i < poly.length; i++) {
			e.get_point(poly[0], p1)
			e.get_point(poly[1], p2)
			e.get_point(poly[i], p3)
			poly.plane.setFromCoplanarPoints(p1, p2, p3)
			if (poly.plane.normal.length() > .5)
				break
		}

		// the xy quaternion rotates poly's plane to the xy-plane so we can do
		// 2d geometry like triangulation on its points.
		poly.xy_quaternion = poly.xy_quaternion || new THREE.Quaternion()
		poly.xy_quaternion.setFromUnitVectors(poly.plane.normal, xy_normal)

		poly.valid = true
	}

	e.poly_plane = function(poly_i) {
		let poly = e.polys[poly_i]
		poly_update_plane(poly)
		return poly.plane
	}

	function poly_get_point_on_xy_plane(poly, i, p) {
		e.get_point(poly[i], p).applyQuaternion(poly.xy_quaternion)
	}

	// length of output index array is always: 3 * (poly.length - 2).
	function triangulate_poly(poly) {
		if (!poly.triangle_pis) {
			poly_update_plane(poly)
			let ps = []
			let p = v3()
			for (let i = 0; i < poly.length; i++) {
				poly_get_point_on_xy_plane(poly, i, p)
				ps.push(p.x, p.y)
			}
			let pis = THREE.Earcut.triangulate(ps, null, 2)
			for (let i = 0; i < pis.length; i++)
				pis[i] = poly[pis[i]]
			poly.triangle_pis	= pis
		}
	}


	e.line_intersects_poly_plane = function(line, poly_i) {
		let plane = e.poly_plane(poly_i)
		let d1 = plane.distanceToPoint(line.start)
		let d2 = plane.distanceToPoint(line.end)
		if ((d1 < -NEARD && d2 > NEARD) || (d2 < -NEARD && d1 > NEARD)) {
			let int_p = plane.intersectLine(line, v3())
			if (int_p) {
				int_p.poly_i = poly_i
				int_p.snap = 'line_plane_intersection'
				return int_p
			}
		}
	}

	// return the line from target line to its closest point
	// with the point index in line.end.i.
	e.line_hit_points = function(target_line, max_d, p2p_distance2, f) {
		let min_ds = 1/0
		let int_line = line3()
		let min_int_line
		let p1 = int_line.start
		let p2 = int_line.end
		let i1 = target_line.start.i
		let i2 = target_line.end.i
		for (let i = 0, len = e.points_len(); i < len; i++) {
			if (i == i1 || i == i2) // don't hit target line's endpoints
				continue
			e.get_point(i, p2)
			target_line.closestPointToPoint(p2, true, p1)
			let ds = p2p_distance2(p1, p2)
			if (ds <= max_d ** 2) {
				if (f && f(int_line, ds) === false)
					continue
				if (ds < min_ds) {
					min_ds = ds
					min_int_line = min_int_line || line3()
					min_int_line.start.copy(p1)
					min_int_line.end.copy(p2)
					min_int_line.end.i = i
				}
			}
		}
		return min_int_line
	}

	e.snap_point_on_line = function(p, line, max_d, p2p_distance2, plane_int_p, axes_int_p) {

		p.i = null
		p.line_i = line.i
		p.snap = 'line'

		max_d = max_d ** 2
		let mp = line.at(.5, v3())
		let d1 = p2p_distance2(p, line.start)
		let d2 = p2p_distance2(p, line.end)
		let dm = p2p_distance2(p, mp)
		let dp = plane_int_p ? p2p_distance2(p, plane_int_p) : 1/0
		let dx = axes_int_p  ? p2p_distance2(p, axes_int_p ) : 1/0

		if (d1 <= max_d && d1 <= d2 && d1 <= dm && d1 <= dp && d1 <= dx) {
			update(p, line.start) // comes with its own point index.
			p.snap = 'point'
		} else if (d2 <= max_d && d2 <= d1 && d2 <= dm && d2 <= dp && d2 <= dx) {
			update(p, line.end) // comes with its own point index.
			p.snap = 'point'
		} else if (dp <= max_d && dp <= d1 && dp <= d2 && dp <= dm && dp <= dx) {
			update(p, plane_int_p) // comes with its own snap flags and indices.
		} else if (dm <= max_d && dm <= d1 && dm <= d2 && dm <= dp && dm <= dx) {
			line.at(.5, p)
			p.snap = 'line_middle'
		} else if (dx <= max_d && dx <= d1 && dx <= d2 && dx <= dm && dx <= dp) {
			update(p, axes_int_p) // comes with its own snap flags and indices.
		}

		// preserve relevant coincidences.
		if (axes_int_p && axes_int_p.equals(p))
			p.line_snap = axes_int_p.line_snap

	}

	// return the point on closest line from target point.
	e.point_hit_lines = function(p, max_d, p2p_distance2, f, each_line) {
		let min_ds = 1/0
		let line = line3()
		let int_p = v3()
		let min_int_p
		each_line = each_line || e.each_line
		each_line(function(line) {
			line.closestPointToPoint(p, true, int_p)
			let ds = p2p_distance2(p, int_p)
			if (ds <= max_d ** 2) {
				if (!(f && f(int_p, line) === false)) {
					if (ds < min_ds) {
						min_ds = ds
						min_int_p = update(min_int_p || v3(), int_p)
					}
				}
			}
		})
		return min_int_p
	}

	// return the point on closest poly line from target point.
	e.point_hit_poly_lines = function(p, poly_i, max_d, p2p_distance2, f) {
		return e.point_hit_lines(p, max_d, p2p_distance2, f, f => e.each_poly_line(f, poly_i))
	}

	// return the projected point on closest line from target line.
	e.line_hit_lines = function(target_line, max_d, p2p_distance2, clamp, f, each_line, is_line_valid) {
		let min_ds = 1/0
		let line = line3()
		let int_line = line3()
		let min_int_p
		each_line = each_line || e.each_line
		is_line_valid = is_line_valid || return_true
		each_line(function(line) {
			if (is_line_valid(line)) {
				let p1i = line.start.i
				let p2i = line.end.i
				let q1i = target_line.start.i
				let q2i = target_line.end.i
				let touch1 = p1i == q1i || p1i == q2i
				let touch2 = p2i == q1i || p2i == q2i
				if (touch1 != touch2) {
					// skip lines with a single endpoint common with the target line.
				} else if (touch1 && touch2) {
					//
				} else {
					if (target_line.intersectLine(line, clamp, int_line)) {
						let ds = p2p_distance2(int_line.start, int_line.end)
						if (ds <= max_d ** 2) {
							int_line.end.line_i = line.i
							if (!(f && f(int_line, line, ds) === false)) {
								if (ds < min_ds) {
									min_ds = ds
									min_int_p = update(min_int_p || v3(), int_line.end)
								}
							}
						}
					}
				}
			}
		})
		return min_int_p
	}

	e.add_line = function(line) {

		let p1 = line.start
		let p2 = line.end

		// check for min. line length for lines with new endpoints.
		if (p1.i == null || p2.i == null) {
			if (p1.distanceToSquared(p2) <= NEARD ** 2)
				return
		} else if (p1.i == p2.i) {
			// check if end point was snapped to start end point.
			return
		}

		let line_ps = [p1, p2] // line's points as an open polygon.

		// cut the line into segments at intersections with existing points.
		line = line3(p1, p2)
		e.line_hit_points(line, NEARD, real_p2p_distance2, function(int_line) {
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
					let ds1 = p1.distanceToSquared(sp1)
					let ds2 = p1.distanceToSquared(sp2)
					return ds1 < ds2
				})
		}

		sort_line_ps()

		// check if any of the line segments intersect any existing lines.
		// the ones that do must be broken down further, and so must the
		// existing lines that are cut by them.
		let seg = line3()
		let line_ps_len = line_ps.length
		for (let i = 0; i < line_ps_len-1; i++) {
			seg.start = line_ps[i]
			seg.end   = line_ps[i+1]
			e.line_hit_lines(seg, NEARD, real_p2p_distance2, true, function(p, line) {
				let line_i = p.line_i
				p = p.clone()
				p.line_i = line_i
				line_ps.push(p)
			})
		}

		// sort the points again if new points were added.
		if (line_ps.length > line_ps_len)
			sort_line_ps()

		// create missing points.
		for (let p of line_ps)
			if (p.i == null) {
				e.point_coords.push(p.x, p.y, p.z)
				p.i = e.points_len() - 1
				print('point', p.i)
			}

		// create line segments.
		for (let i = 0, len = line_ps.length; i < len-1; i++) {
			let p1i = line_ps[i  ].i
			let p2i = line_ps[i+1].i
			e.line_pis.push(p1i, p2i)
			print('line', p1i, p2i)
		}

		// cut intersecting lines in two.
		for (let p of line_ps) {
			if (p.line_i != null) {
				let p1i = e.line_pis[2*p.line_i  ]
				let p2i = e.line_pis[2*p.line_i+1]
				let pmi = p.i
				e.line_pis[2*p.line_i  ] = p1i
				e.line_pis[2*p.line_i+1] = pmi
				e.line_pis.push(pmi, p2i)
			}
		}

		e.invalidate()
	}

	e.remove_line = function(line_i) {
		//
		e.invalidate()
	}

	e.move_line = function(line_i, rel_p) {
		//
		e.invalidate()
	}

	e.move_point = function(p_i, rel_p) {
		//
		e.invalidate()
	}

	e.remove_poly = function(poly) {
		if (e.polys.remove_value(poly))
			e.invalidate()
	}

	// rendering

	e.group = new THREE.Group()
	e.group.poly_mesh = e
	e.group.name = e.name

	let dispose = []

	e.invalidate = function() {

		e.group.clear()

		for (let ce of dispose)
			ce.dispose()

		let points = new THREE.BufferAttribute(new Float32Array(e.point_coords), 3)

		let i = 0
		for (let poly of e.polys) {

			triangulate_poly(poly)

			let geo = new THREE.BufferGeometry()

			geo.setAttribute('position', points)
			geo.setIndex(poly.triangle_pis)
			geo.computeVertexNormals()

			let mat = new THREE.MeshPhongMaterial({
				color: 0xffffff,
				side: THREE.DoubleSide,
				polygonOffset: true,
				polygonOffsetFactor: 1,
			})

			let mesh = new THREE.Mesh(geo, mat)
			mesh.i = i++
			mesh.poly_mesh = e
			mesh.castShadow = true

			e.group.add(mesh)

			dispose.push(geo, mat)

		}

		{
			let coords = []
			for (let i = 0, len = e.points_len(), p = v3(); i < len; i++) {
				e.get_point(i, p)
				coords.push(p.x, p.y, p.z)
			}

			let pos = new THREE.BufferAttribute(new Float32Array(coords), 3)
			let geo = new THREE.BufferGeometry()
			geo.setAttribute('position', pos)

			let mat = new THREE.PointsMaterial({
				color: 0x000000,
				size: 4,
				sizeAttenuation: false,
			})

			let points = new THREE.Points(geo, mat)
			points.layers.set(1) // make it non-hit-testable.

			e.group.add(points)

			dispose.push(geo, mat)
		}

		{
			let geo = new THREE.BufferGeometry()
			geo.setAttribute('position', points)
			geo.setIndex(e.line_pis)

			let mat = new THREE.LineBasicMaterial({
				color: 0x000000,
			})

			let lines = new THREE.LineSegments(geo, mat)
			lines.poly_mesh = e
			lines.layers.set(1) // make it non-hit-testable.

			e.group.add(lines)

			dispose.push(geo, mat)
		}

	}

	return e
}

// editor --------------------------------------------------------------------

component('x-modeleditor', function(e) {

	let pe = e

	// canvas, renderer, scene ------------------------------------------------

	e.canvas = tag('canvas')
	focusable_widget(e, e.canvas)
	e.canvas.attr('tabindex', -1)
	e.canvas.attr('style', 'position: absolute')
	e.add(e.canvas)

	e.context = assert(e.canvas.getContext('webgl2'))

	e.renderer = new THREE.WebGLRenderer({canvas: e.canvas, context: e.context, antialias: true})
	e.renderer.setPixelRatio(window.devicePixelRatio)
	e.renderer.outputEncoding = THREE.sRGBEncoding
	e.renderer.shadowMap.enabled = true

	e.renderer.setAnimationLoop(function() {
		e.renderer.render(e.scene, e.camera)
	})

	e.scene = new THREE.Scene()

	function init() {

		e.scene.add(skydome())
		e.axes = axes()
		e.scene.add(e.axes)
		e.xyplane = xyplane(); e.scene.add(e.xyplane)
		e.zyplane = zyplane(); e.scene.add(e.zyplane)
		e.xzplane = xzplane(); e.scene.add(e.xzplane)
		e.ref_planes = [e.xyplane, e.zyplane, e.xzplane]
		e.scene.add(hemlight())
		e.dirlight = dirlight()
		e.scene.add(e.dirlight)

		// update state

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
	}

	// camera -----------------------------------------------------------------

	e.camera = new THREE.PerspectiveCamera(60, 1, MIND * 100, MAXD * 100)
	e.camera.canvas = e.canvas // for v3.project_to_canvas()
	e.camera.layers.enable(1) // render objects that we don't hit test.
	e.camera.position.x = 2
	e.camera.position.y = 4
	e.camera.position.z = 4
	e.scene.add(e.camera)

	// screen-projected distances for hit testing -----------------------------

	e.snap_d = SNAPD
	e.sel_d  = SELD

	{
		let p = v3()
		let q = v3()
		function canvas_p2p_distance2(p1, p2) {
			p1.project_to_canvas(e.camera, p)
			p2.project_to_canvas(e.camera, q)
			return p.distanceToSquared(q)
		}
	}

	// hemlight ---------------------------------------------------------------

	function hemlight() {
		let e = new THREE.HemisphereLight(0xffffff, 0xffffff, 0.6)
		e.color.setHSL(0.6, 1, 0.6)
		e.groundColor.setHSL(0.095, 1, 0.75)
		e.position.set(0, 0, 0)
		return e
	}

	// dirlight ---------------------------------------------------------------

	function dirlight() {
		let e = new THREE.DirectionalLight(0xffffff, 1)
		/*
		e.castShadow = true
		e.shadow.mapSize.width = 2048
		e.shadow.mapSize.height = 2048
		let d = 50
		e.shadow.camera.left = - d
		e.shadow.camera.right = d
		e.shadow.camera.top = d
		e.shadow.camera.bottom = - d
		e.shadow.camera.far = 3500
		e.shadow.bias = - 0.0001
		*/
		return e
	}

	// skydome ----------------------------------------------------------------

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
			uniform vec3 sky_color;
			uniform vec3 horizon_color;
			uniform vec3 ground_color;
			uniform float offset;
			uniform float exponent;
			varying vec3 vWorldPosition;
			void main() {
				float h = normalize(vWorldPosition).y;
				gl_FragColor = vec4(
					mix(
						mix(horizon_color, sky_color, pow(max(h, 0.0), exponent)),
						ground_color,
						1.0-step(0.0, h)
				), 1.0);
			}
		`

		let uniforms = {
			sky_color     : {value: color3(0xccddff)},
			horizon_color : {value: color3(0xffffff)},
			ground_color  : {value: color3(0xe0dddd)},
			exponent      : {value: .5},
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

	// cursor -----------------------------------------------------------------

	{
		let cursor_x = {line:  0}
		let cursor_y = {line: 25}
		let cursor
		e.property('cursor', () => cursor, function(name) {
			cursor = name
			let x = cursor_x[name] || 0
			let y = cursor_y[name] || 0
			e.canvas.style.cursor = 'url(cursor_'+name+'.png) '+x+' '+y+', auto'
		})
	}

	// cursor tooltip ---------------------------------------------------------

	{
		let timer
		let tooltip_text = ''
		let tooltip = div({style: `
			position: absolute;
			white-space: nowrap;
			user-select: none;
			margin-left: .5em;
			margin-top : .5em;
			padding: .25em .5em;
			border: 1px solid #aaaa99;
			color: #333;
			background-color: #ffffcc;
			font-family: sans-serif;
			font-size: 12px;
		`}, tooltip_text)

		tooltip.hide()
		e.add(tooltip)

		function show_tooltip() {
			tooltip.show()
			timer = null
		}

		e.property('tooltip', () => tooltip_text, function(s) {
			if (timer) {
				clearInterval(timer)
				timer = null
			}
			tooltip.hide()
			if (s) {
				tooltip.set(s)
				tooltip.x = e.mouse.x
				tooltip.y = e.mouse.y
				timer = setTimeout(show_tooltip, 200)
			}
		})
	}

	// helper lines -----------------------------------------------------------

	{
		let dotted_mat

		e.line = function(name, line, dotted, color) {

			color = color || 0

			let e, mat

			if (dotted) {

				if (!dotted_mat) {

					let vshader = `
						flat out vec4 p0;
						out vec4 p;
						void main() {
							vec4 p1 = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
							gl_Position = p1;
							p  = p1;
							p0 = p1;
						}
					`

					let fshader = `
						precision highp float;
						flat in vec4 p0;
						in vec4 p;
						uniform vec3  color;
						uniform vec2  canvas;
						uniform float dash;
						uniform float gap;
						void main(){
							vec2 dir = ((p.xyz / p.w).xy - (p0.xyz / p0.w).xy) * canvas.xy / 2.0;
							float dist = length(dir);
							if (fract(dist / (dash + gap)) > dash / (dash + gap))
								discard;
							gl_FragColor = vec4(color.rgb, 1.0);
						}
					`

					let uniforms = {
						 canvas : {type: 'v2', value: {x: 0, y: 0}},
						 dash   : {type: 'f' , value: 1},
						 gap    : {type: 'f' , value: 3},
						 color  : {value: color3(color)},
					}

					dotted_mat = new THREE.ShaderMaterial({
							uniforms       : uniforms,
							vertexShader   : vshader,
							fragmentShader : fshader,
						})

				}

				mat = dotted_mat.clone()

				function resized(r) {
					mat.uniforms.canvas.value.x = r.w
					mat.uniforms.canvas.value.y = r.h
				}

				pe.on('resize', resized)

				mat.set_color = function(color) {
					this.uniforms.color.value.set(color)
				}

				mat.set_color(color)

				mat.free = function() {
					pe.off('resize', resized)
				}

			} else {

				mat = new THREE.LineBasicMaterial({color: color, polygonOffset: true})

				mat.set_color = function(color) {
					this.color.set(color)
				}

				mat.free = noop

			}

			let geo = new THREE.BufferGeometry().setFromPoints([line.start, line.end])

			e = new THREE.LineSegments(geo, mat)
			e.line = line
			e.name = name

			property(e, 'color', () => color, function(color1) {
				color = color1
				mat.set_color(color)
			})

			e.free = function() {
				mat.free()
				pe.scene.remove(e)
				geo.dispose()
				mat.dispose()
			}

			e.update = function() {
				let pb = geo.attributes.position
				let p1 = e.line.start
				let p2 = e.line.end
				pb.setXYZ(0, p1.x, p1.y, p1.z)
				pb.setXYZ(1, p2.x, p2.y, p2.z)
				pb.needsUpdate = true
			}

			e.update_endpoints = function(p1, p2) {
				e.line.start.copy(p1)
				e.line.end.copy(p2)
				e.update()
				e.visible = true
			}

			pe.scene.add(e)

			return e

		}

	}

	// helper dots ------------------------------------------------------------

	{
		let dot2d_styles = {
			default: `
				position: absolute;
				pointer-events: none;
				margin-left: -4px;
				margin-top : -4px;
				width : 8px;
				height: 8px;
				border-radius: 100%;
				border: 1px solid black;
			`
		}

		e.dot = function(point) {

			let e = div()
			e.point = point || v3()

			let type
			property(e, 'type', () => type, function(type1) {
				if (type1 == type) return
				type = type1
				e.style = dot2d_styles[type || 'default']
			})

			let color
			property(e, 'color', () => color, function(color1) {
				if (color1 == color) return
				color = color1
				e.style['background-color'] = color
			})

			let p = v3()
			e.update = function() {
				p.copy(e.point).project(pe.camera)
				let x = round(( p.x + 1) * pe.canvas.width  / 2)
				let y = round((-p.y + 1) * pe.canvas.height / 2)
				e.x = x
				e.y = y
			}

			e.update_point = function(p) {
				e.point.copy(p)
				e.visible = true
				e.update()
			}

			property(e, 'visible',
				function()  { return !e.hasattr('hidden') },
				function(v) { e.show(!!v) }
			)

			e.free = function() {
				e.remove()
			}

			e.type = 'default'

			pe.add(e)

			return e
		}
	}

	function update_dot_positions() {
		for (let ce of e.at)
			if (ce.update)
				ce.update()
	}

	// helper vectors ---------------------------------------------------------

	let helpers = {}

	function v3d(id, vector, origin) {
		let e = helpers[id]
		if (!e) {
			e = new THREE.Group()
			e.line = pe.line(id, line3())
			let geo = new THREE.ConeGeometry(.01, .04)
			geo.translate(0, -.04 / 2, 0)
			geo.rotateX(PI / 2)
			let mat = new THREE.MeshPhongMaterial({color: 0x333333})
			e.cone = new THREE.Mesh(geo, mat)
			e.add(e.line)
			e.add(e.cone)
			e.origin = v3()
			e.vector = v3()
			e.update = function() {
				let len = e.vector.length()
				e.line.line.end.z = len
				e.cone.position.z = len
				e.line.update()
				let p = e.position.clone()
				e.position.copy(v3())
				e.lookAt(e.vector)
				e.position.copy(p)
			}
			helpers[id] = e
			pe.scene.add(e)
		}
		if (vector)
			e.vector.copy(vector)
		if (origin)
			e.position.copy(origin)
		e.update()
	}

	// axes -------------------------------------------------------------------

	function axis(name, p, color, dotted) {
		return e.line(name, line3(v3(), p.setLength(MAXD)), dotted, color)
	}

	function axes() {
		let e = new THREE.Group()
		let green = 0x006600
		let red   = 0x990000
		let blue  = 0x000099
		let axes = [
			axis('+z_axis', v3( 0,  0, -1), green),
			axis('+x_axis', v3( 1,  0,  0), red  ),
			axis('+y_axis', v3( 0,  1,  0), blue ),
			axis('-z_axis', v3( 0,  0,  1), green, true),
			axis('-x_axis', v3(-1,  0,  0), red  , true),
			axis('-y_axis', v3( 0, -1,  0), blue , true),
		]
		e.add(...axes)
		return e
	}

	// reference planes -------------------------------------------------------

	function ref_plane(
			name, normal, plane_hit_tooltip,
			main_axis_snap, main_axis, main_axis_snap_tooltip
	) {
		let geo = new THREE.PlaneBufferGeometry(2*MAXD, 2*MAXD)
		let mat = new THREE.MeshLambertMaterial({depthTest: false, visible: false, side: THREE.DoubleSide})
		let e = new THREE.Mesh(geo, mat)
		e.name = name

		let hits = []

		e.ray_hit_plane = function(plane_position) {
			e.position.copy(plane_position)
			hits.length = 0
			let h = pe.raycaster.intersectObject(e, false, hits)[0]
			if (!h)
				return
			let p = h.point
			let plane_dir = pe.raycaster.ray.origin.clone().projectOnPlane(v3(0, 1, 0))
			let angle = plane_dir.angleTo(normal)
			if (angle > PI / 2)
				angle = abs(angle - PI)
			p.angle = angle
			p.tooltip = plane_hit_tooltip
			return p
		}

		e.ray_hit_main_axis = function(axis_position) {
			e.position.copy(axis_position)
			let h = pe.raycaster.intersectObject(e)[0]
			if (!h)
				return
			let p1 = h.point.clone().sub(axis_position)
			let p21 = main_axis.clone().setLength(p1.length())
			let p22 = p21.clone().negate()
			let ds1 = canvas_p2p_distance2(p1, p21)
			let ds2 = canvas_p2p_distance2(p1, p22)
			let p2 = ds1 < ds2 ? p21 : p22
			let ds = min(ds1, ds2)
			if (ds > e.snap_d ** 2)
				return
			let p = p2.add(axis_position)
			p.ds = ds
			p.line_snap = main_axis_snap
			p.tooltip = main_axis_snap_tooltip
			return p
		}

		// intersect the plane's main axis from an origin with a line
		// and return the projected point on the line.
		let int_line = line3()
		let main_axis_line = line3()
		e.main_axis_hit_line = function(line, axis_position, int_p) {
			main_axis_line.start.copy(axis_position)
			main_axis_line.end.copy(axis_position).add(main_axis)
			if (!main_axis_line.intersectLine(line, false, int_line))
				return
			let ds = int_line.start.distanceToSquared(int_line.end)
			if (ds > NEARD ** 2)
				return
			int_p.copy(int_line.end)
			int_p.line_snap = main_axis_snap
			return true
		}

		return e
	}

	function xyplane() {
		return ref_plane(
			'xyplane', v3(0, 0, 1), 'on the blue-red vertical plane',
			'blue_axis', v3(0, 1, 0), 'on blue axis')
	}

	function zyplane() {
		let e = ref_plane(
			'zyplane', v3(1, 0, 0), 'on the blue-green vertical plane',
			'green_axis', v3(0, 0, 1), 'on green axis')
		e.rotation.y = -PI / 2
		return e
	}

	function xzplane() {
		let e = ref_plane(
			'xzplane', v3(0, 1, 0), 'on the horizontal plane',
			'red_axis', v3(1, 0, 0), 'on red axis')
		e.rotation.x = -PI / 2
		return e
	}

	function ray_hit_ref_planes(plane_position) {
		// hit horizontal plane first.
		let p = e.xzplane.ray_hit_plane(plane_position)
		if (p)
			return p
		// hit vertical ref planes.
		let p1 = e.xyplane.ray_hit_plane(plane_position)
		let p2 = e.zyplane.ray_hit_plane(plane_position)
		// pick whichever plane is facing the camera more straightly.
		return (p1 ? p1.angle : 1/0) < (p2 ? p2.angle : 1/0) ? p1 : p2
	}

	{
		let ps = []
		let cmp_ps = function(p1, p2) {
			let ds1 = p1 ? p1.ds : 1/0
			let ds2 = p2 ? p2.ds : 1/0
			return ds1 == ds2 ? 0 : (ds1 < ds2 ? -1 : 1)
		}
		function ray_hit_axes(axis_position) {
			let i = 0
			for (let plane of e.ref_planes)
				ps[i++] = plane.ray_hit_main_axis(axis_position)
			ps.sort(cmp_ps)
			return ps[0]
		}

	}

	{
		let int_p = v3()
		let ret = v3()
		function axes_hit_line(axes_origin, line) {
			let min_ds = 1/0
			let min_int_p
			for (let plane of e.ref_planes) {
				if (plane.main_axis_hit_line(line, axes_origin, int_p)) {
					let ds = sqrt(canvas_p2p_distance2(p, int_p))
					if (ds <= e.snap_d ** 2 && ds <= min_ds) {
						min_ds = ds
						min_int_p = update(min_int_p || v3(), int_p)
					}
				}
			}
			return min_int_p
		}
	}

	// model ------------------------------------------------------------------

	e.components = {} // {name->group}
	e.model = new THREE.Group()
	e.model.name = 'model'
	e.scene.add(e.model)
	e.instance = poly_mesh()
	e.model.add(e.instance.group)

	// direct-manipulation tools ==============================================

	let tools = {}

	// select tool ------------------------------------------------------------

	tools.select = {}

	tools.select.pointerdown = function(e) {

		let h = e.raycaster.intersectObject(e.model, true)[0]
		if (!h)
			return

	}

	// orbit tool -------------------------------------------------------------

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
		e.camera.updateProjectionMatrix()
		e.camera.getWorldDirection(e.dirlight.position)
		e.dirlight.position.negate()
	}

	// current point hit-testing and snapping ---------------------------------

	function ray_hit_polys() {
		let hit = e.raycaster.intersectObject(e.model, true)[0]
		if (!(hit && hit.object.type == 'Mesh'))
			return
		hit.point.poly_i = hit.object.i
		hit.point.snap = 'face'
		return hit.point
	}

	function ray_hit_model(axes_origin) {

		let p = ray_hit_polys()

		if (p) {
			// we've hit a poly face, but we still have to hit any lines
			// that lie in front of it, on it, or intersecting it.

			let p0 = e.raycaster.ray.origin
			let ray = line3(p0, e.raycaster.ray.direction.clone().setLength(2*MAXD).add(p0))
			let plane = e.instance.poly_plane(p.poly_i)

			function is_line_not_behind_plane(line) {
				let d1 = plane.distanceToPoint(line.start)
				let d2 = plane.distanceToPoint(line.end)
				return d1 > 0 || d2 > 0 || (d1 == 0 && d2 == 0)
			}

			let p1 = e.instance.line_hit_lines(ray, e.snap_d, canvas_p2p_distance2, true,
				null, null, is_line_not_behind_plane)

			if (p1) {

				// we've hit a line. snap to it.
				update(p, p1) // keep poly_i.

				let line = e.instance.get_line(p.line_i)
				print(p.poly_i, is_line_not_behind_plane(line))

				// // check if the hit line intersects the hit plane: that's a snap point.
				// let plane_int_p = e.instance.line_intersects_poly_plane(line, p.poly_i)
				// // check if the hit line intersects any axes originating at line start: that's a snap point.
				// let axes_int_p = axes_origin && axes_hit_line(axes_origin, line)
				// // snap the hit point along the hit line along with any additional snap points.
				// e.instance.snap_point_on_line(p, line, e.snap_d, canvas_p2p_distance2, plane_int_p, axes_int_p)
				// // if the snapped point ended up behind the plane, move it to on-plane.
				// if (plane.distanceToPoint(p) < 0)
				// 	update(p, plane_int_p)

			} else {

				// free moving on the poly face.


			}

		} else {

			// we haven't hit a face: hit the line closest to the ray regardless of depth.
			let p0 = e.raycaster.ray.origin
			let p1 = e.raycaster.ray.direction
			let ray = line3(p0, p1.clone().setLength(2 * MAXD).add(p0))
			p = e.instance.line_hit_lines(ray, e.snap_d, canvas_p2p_distance2, true)

			if (p) {
				// check if the hit line intersects any axes originating at line start: that's a snap point.
				let axes_int_p //= axes_origin && axes_hit_line(axes_origin, line)
				// snap the hit point along the hit line along with any additional snap points.
				let line = e.instance.get_line(p.line_i)
				e.instance.snap_point_on_line(p, line, e.snap_d, canvas_p2p_distance2, null, axes_int_p)
			}

		}

		return p
	}

	// line tool --------------------------------------------------------------

	tools.line = {}

	tools.line.bind = function(e, on) {
		if (on) {
			let endp = v3()
			e.cur_point = e.dot(endp)
			e.cur_line = e.line('cur_line', line3(v3(), endp))
			e.cur_line.color = 0x000000
			e.cur_point.visible = false
			e.cur_line.visible = false
			e.ref_point = e.dot()
			e.ref_point.visible = false
			e.ref_line = e.line('ref_line', line3(), true)
			e.ref_line.visible = false
		} else {
			tools.line.cancel()
			e.cur_point = e.cur_point.free()
			e.cur_line  = e.cur_line.free()
			e.ref_point = e.ref_point.free()
		}
	}

	tools.line.cancel = function() {
		e.tooltip = ''
		e.cur_line.visible = false
		e.ref_point.visible = false
		e.ref_line.visible = false
	}

	let snap_tooltips = {
		point: 'on point',
		line: 'on line',
		point_line: 'touching point',
		line_middle: 'on line middle',
	}

	let point_snap_colors = {
		point: '#000000',
		line: '#ff00ff',
		line_middle: '#ffff00',
	}

	let line_snap_colors = {
		point_line : 0xff00ff,
		blue_axis  : 0x0000ff,
		red_axis   : 0xff0000,
		green_axis : 0x00ff00,
	}

	tools.line.pointermove = function(e) {

		let cline = e.cur_line.line
		let p1 = cline.start
		let p2 = cline.end
		p2.i = null
		p2.poly_i = null
		p2.line_i = null
		p2.snap = null
		p2.line_snap = null
		p2.tooltip = null

		e.ref_line.snap = null
		e.ref_line.visible = false

		let p

		if (!e.cur_line.visible) { // moving the start point

			p = ray_hit_model() || ray_hit_ref_planes(v3())

			if (p) {
				update(p1, p)
				update(p2, p)
			}

		} else { // moving the line end-point

			p = ray_hit_model(p1) || ray_hit_axes(p1) || ray_hit_ref_planes(p1)

			// changing the ref point.
			if (p && p.i != null && p.i != cline.start.i)
				e.ref_point.update_point(p)

			if (p && !p.snap) { // free-moving point.

				// snap point to axes originating at the ref point.
				if (e.ref_point.visible) {
					update(cline.end, p)
					let p_line_snap = p.line_snap
					let axes_int_p = axes_hit_line(e.ref_point.point, cline)
					if (axes_int_p) {
						update(p, axes_int_p)
						e.ref_line.snap = axes_int_p.line_snap
						p.line_snap = p_line_snap
						e.ref_line.update_endpoints(e.ref_point.point, p)
					}
				}

				// check again if the snapped point hits the model.
				//p = ray_hit_model()
				//
				//let p1 = e.instance.point_hit_lines(p, e.snap_d, canvas_p2p_distance2)
				//if (p1) {
				//	p = p1
				//	e.instance.snap_point_on_line(int_p, line, max_d, p2p_distance2)
				//}

			}

			if (p)
				update(p2, p)

		}

		p = p2

		e.cur_point.visible = !!p.snap
		e.tooltip = snap_tooltips[p.snap || p.line_snap] || p.tooltip
		e.cur_point.color = point_snap_colors[p2.snap] || ''
		e.cur_line.color = line_snap_colors[p2.line_snap] || 0x000000
		e.ref_line.color = line_snap_colors[e.ref_line.snap] || 0x000000

		e.cur_point.update()
		e.cur_line.update()
		e.ref_line.update()

	}

	tools.line.pointerdown = function(e) {
		e.tooltip = ''
		if (e.cur_line.visible) {
			let cline = e.cur_line.line
			let closing = cline.end.i != null || cline.end.line_i != null
			e.instance.add_line(cline)
			if (closing) {
				tools.line.cancel()
			} else {
				cline.start.copy(cline.end)
				cline.start.i = cline.end.i
			}
		} else {
			e.cur_line.visible = true
			e.ref_point.update_point(e.cur_line.line.start)
		}
	}

	tools.line.keydown = function(e, key) {
		if (key == 'Escape') {
			tools.line.cancel()
			return false
		}
	}

	// rectangle tool ---------------------------------------------------------

	tools.rect = {}

	tools.rect.pointerdown = function(e) {

	}

	// push/pull tool ---------------------------------------------------------

	tools.pull = {}

	tools.pull.pointerdown = function(e) {
		//
	}

	// move tool --------------------------------------------------------------

	tools.move = {}

	// current tool -----------------------------------------------------------

	let tool
	{
		let toolname
		e.property('tool', () => toolname, function(name) {
			e.tooltip = ''
			if (tool && tool.bind)
				tool.bind(e, false)
			tool = assert(tools[name])
			toolname = name
			if (tool.bind)
				tool.bind(e, true)
			if (tool.pointermove)
				tool.pointermove(e, ev)
			e.cursor = tool.cursor || name
		})
	}

	// mouse handling ---------------------------------------------------------

	e.mouse = v2()
	e.raycaster = new THREE.Raycaster()
	// TODO: remove
	e.raycaster.params.Line.threshold = SELD

	{
		let pm = v2()
		function update_mouse(mx, my) {
			e.mouse.x = mx
			e.mouse.y = my
			// calculate mouse position in normalized device coordinates.
			pm.x =  (mx / e.canvas.width ) * 2 - 1
			pm.y = -(my / e.canvas.height) * 2 + 1
			e.raycaster.setFromCamera(pm, e.camera)
		}
	}

	e.on('pointermove', function(ev, mx, my) {
		update_mouse(mx, my)
		if (tool.pointermove)
			tool.pointermove(e)
	})

	e.on('pointerdown', function(ev, mx, my) {
		update_mouse(mx, my)
		if (tool.pointerdown) {
			function capture(move, up) {
				let movewrap = move && function(ev, mx, my) {
					update_mouse(mx, my)
					return move(e, ev)
				}
				let upwrap = up && function(ev, mx, my) {
					update_mouse(mx, my)
					return up(e, ev)
				}
				return e.capture_pointer(ev, movewrap, upwrap)
			}
			tool.pointerdown(e, capture)
			if (tool.pointermove)
				tool.pointermove(e)
		}
	})

	e.on('pointerleave', function(ev) {
		e.tooltip = ''
	})

	e.canvas.on('wheel', function(ev, delta) {
		e.controls.enableZoom = false
		let factor = .1
		let mx =  (ev.clientX / e.canvas.width ) * 2 - 1
		let my = -(ev.clientY / e.canvas.height) * 2 + 1
		let v = v3(mx, my, 0.5)
		v.unproject(e.camera)
		v.sub(e.camera.position)
		v.setLength(factor)
		if (delta < 0) {
			e.camera.position.add(v)
			e.controls.target.add(v)
		} else {
			e.camera.position.sub(v)
			e.controls.target.sub(v)
		}
		e.controls.update()
		e.camera.updateProjectionMatrix()
		e.camera.getWorldDirection(e.dirlight.position)
		e.dirlight.position.negate()
		update_dot_positions()
		return false
	})

	// key handling -----------------------------------------------------------

	let tool_keys = {
		l: 'line',
		r: 'rect',
		p: 'pull',
		o: 'orbit',
		m: 'move',
	}

	e.on('keydown', function(key, shift, ctrl) {
		if (shift || ctrl)
			return
		if (tool.keydown)
			if (tool.keydown(e, key) === false)
				return false
		let toolname = tool_keys[key.toLowerCase()]
		if (toolname) {
			e.tool = toolname
			return false
		} else if (key == ' ') {
			e.tool = e.tool == 'select' ? 'orbit' : 'select'
			return false
		}
	})

	// test cube --------------------------------------------------------------


	function draw_test_cube() {

		e.instance.point_coords = [
 			 0,  0,  0,
			 2,  0,  0,
			 2,  2,  0,
			 0,  2,  0,
		 	 0,  0,  2,
			.3,  0, .3,
			.3,  2, .3,
			 0,  2,  2,
		]

		e.instance.line_pis = [
			0, 1, 1, 2, 2, 3, 3, 0,
			4, 5, 5, 6, 6, 7, 7, 4,
			0, 4, 1, 5, 2, 6, 3, 7,
		]

		e.instance.polys = [
			[1, 0, 3, 2],
			[4, 5, 6, 7],
			[7, 6, 2, 3],
			[1, 0, 4, 5],
			[0, 4, 7, 3],
			[5, 1, 2, 6],
		]

		e.instance.invalidate()

		//e.instance.group.position.y = 1

	}

	// init -------------------------------------------------------------------

	init()
	draw_test_cube()
	e.tool = 'orbit'

})

})()
