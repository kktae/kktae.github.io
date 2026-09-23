import test from 'node:test';
import assert from 'node:assert/strict';
import { sharpCorners, orthogonalPath, crossesBox, pathPoints, pathMidpoint, feedbackRoute } from '../assets/js/mermaid-geometry.mjs';

test('ELK rounded corners become orthogonal segments without moving clipped endpoints', () => {
  const path = 'M10,4L10,15Q10,20 15,20L25,20Q30,20 30,25L30,36';
  assert.equal(sharpCorners(path), 'M10,4L10,15L10,20L15,20L25,20L30,20L30,25L30,36');
});
test('negative, decimal and scientific coordinates retain precision', () => {
  assert.equal(sharpCorners('M-1.5,2Q-1.5,3e-2 .5,3e-2L.5,4'),
    'M-1.5,2L-1.5,3e-2L.5,3e-2L.5,4');
});
test('straight edges and repeated decoration are unchanged', () => {
  const path = 'M10,4L10,20L30,20L30,36';
  assert.equal(sharpCorners(path), path);
  assert.equal(sharpCorners(sharpCorners(path)), path);
});
test('diamond intersections get one right-angle turn with unchanged endpoints', () => {
  assert.equal(orthogonalPath('M10,10L15,12L20,14L40,14'), 'M10,10L20,10L20,14L40,14');
  assert.equal(orthogonalPath('M10,10L12,15L14,20L14,40'), 'M10,10L10,20L14,20L14,40');
});
test('orthogonal normalization preserves reversals and is idempotent', () => {
  const path = 'M10,10L20,10L10,10L10,20';
  assert.equal(orthogonalPath(path), path);
  const normalized = orthogonalPath('M10,10L15,12L20,14L40,14');
  assert.equal(orthogonalPath(normalized), normalized);
});
test('header collision detects crossing and allows routes outside or along its boundary', () => {
  const header = { x: 20, y: 30, width: 100, height: 28 };
  assert.equal(crossesBox([{x:50,y:0},{x:50,y:80}],header),true);
  assert.equal(crossesBox([{x:0,y:40},{x:140,y:40}],header),true);
  assert.equal(crossesBox([{x:0,y:80},{x:0,y:70},{x:140,y:70}],header),false);
  assert.equal(crossesBox([{x:20,y:0},{x:20,y:80}],header),false);
});

test('point parser rejects unsupported curves and multiple subpaths instead of misrouting them', () => {
  assert.deepEqual(pathPoints('M1,2L3,4'),[{x:1,y:2},{x:3,y:4}]);
  assert.equal(pathPoints('M1,2C3,4 5,6 7,8'),null);
  assert.equal(pathPoints('M1,2M3,4'),null);
});
test('edge labels use the midpoint of total path length, including unequal segments', () => {
  assert.deepEqual(pathMidpoint([{x:0,y:0},{x:100,y:0},{x:100,y:20}]),{x:60,y:0});
  assert.deepEqual(pathMidpoint([{x:4,y:5},{x:4,y:5}]),{x:4,y:5});
  assert.deepEqual(pathMidpoint([]),{x:0,y:0});
});
const headers=[{x:150,y:20,width:40,height:28}];
const nodes=[{x:160,y:150,width:20,height:20},{x:160,y:50,width:20,height:20},{x:0,y:300,width:10,height:10}];
const feedback=[{x:170,y:170},{x:170,y:185},{x:0,y:185},{x:0,y:0},{x:170,y:0},{x:170,y:46}];
test('feedback routing chooses the shorter unobstructed outside side', () => {
  const route=feedbackRoute(feedback,nodes,headers);
  assert(route[2].x>190);
  assert.deepEqual(route[0],feedback[0]);
  assert.deepEqual(route.at(-1),{x:184,y:60});
  assert(![...nodes,...headers].some(b=>crossesBox(route,b)));
});
test('feedback routing switches sides when obstructed and declines when both sides are blocked', () => {
  const right={x:190,y:180,width:10,height:10},left={x:130,y:180,width:10,height:10};
  assert(feedbackRoute(feedback,[...nodes,right],headers)[2].x<0);
  assert.equal(feedbackRoute(feedback,[...nodes,right,left],headers),null);
});
test('feedback routing does not exit back through the source node', () => {
  assert.equal(feedbackRoute([{x:170,y:150},...feedback.slice(1)],nodes,headers),null);
});
