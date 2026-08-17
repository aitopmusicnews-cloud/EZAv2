import assert from 'node:assert/strict';
import { createAgnesVideo, getAgnesResultOnce } from './.tmp-http/agnes_http.js';

function jsonResponse(body, status=200) {
  return new Response(JSON.stringify(body), {status, headers:{'content-type':'application/json'}});
}
let init;
const ids = await createAgnesVideo({prompt:'scene',width:1152,height:768,numFrames:121}, 'secret', async (_u, i)=>{init=i;return jsonResponse({video_id:'v1',task_id:'t1'});});
assert.deepEqual(ids,{videoId:'v1',taskId:'t1'});
let body=JSON.parse(String(init.body));
assert.equal(body.model,'agnes-video-v2.0'); assert.equal(body.frame_rate,24); assert.equal(body.num_frames,121); assert.equal(body.image,undefined);
await createAgnesVideo({prompt:'move',imageUrl:'https://example.com/a.png',width:1152,height:768,numFrames:121}, 'secret', async (_u,i)=>{init=i;return jsonResponse({video_id:'v2'});});
body=JSON.parse(String(init.body)); assert.equal(body.image,'https://example.com/a.png');
await createAgnesVideo({prompt:'transition',keyframeUrls:['https://example.com/a.png','https://example.com/b.png'],width:1152,height:768,numFrames:121}, 'secret', async (_u,i)=>{init=i;return jsonResponse({video_id:'v3'});});
body=JSON.parse(String(init.body)); assert.deepEqual(body.extra_body,{image:['https://example.com/a.png','https://example.com/b.png'],mode:'keyframes'});
for (const status of ['pending','queued','in_progress']) {
  const r=await getAgnesResultOnce({videoId:'v',taskId:'t'},'secret',async()=>jsonResponse({status}));
  assert.deepEqual(r,{kind:'waiting',status});
}
const done=await getAgnesResultOnce({videoId:'v',taskId:'t'},'secret',async()=>jsonResponse({status:'completed',metadata:{url:'https://cdn.example.com/out.mp4'}}));
assert.deepEqual(done,{kind:'completed',url:'https://cdn.example.com/out.mp4'});
let calls=0;
const fallback=await getAgnesResultOnce({videoId:'v',taskId:'t'},'secret',async()=>{calls++; return calls===1?jsonResponse({status:'completed',metadata:{}}):jsonResponse({status:'completed',metadata:{url:'https://cdn.example.com/fallback.mp4'}})});
assert.equal(calls,2); assert.equal(fallback.url,'https://cdn.example.com/fallback.mp4');
console.log('agnes http tests passed');
