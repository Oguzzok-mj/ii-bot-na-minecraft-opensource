const assert=require('node:assert/strict'),path=require('node:path')
const root=path.resolve(__dirname,'..'),{Vec3}=require(path.join(root,'node_modules/vec3'))
const position=new Vec3(.5,20,.5),near=new Vec3(4,20,0),far=new Vec3(8,20,0)
let lava=false,mined=false
const bot={entity:{position},game:{dimension:'overworld'},registry:{blocksByName:{}},findBlocks:()=>[near,far],
 blockAt:p=>({position:p,name:lava&&p.equals(far.offset(1,0,0))?'lava':p.equals(near)||p.equals(far)&&!mined?'diamond_ore':p.y<20?'stone':'air',boundingBox:p.y<20||p.equals(near)||p.equals(far)&&!mined?'block':'empty',hardness:1}),digTime:()=>500}
const skills={limited:async p=>p,blocked:new Map(),key:p=>`${p.x},${p.y},${p.z}`,count:()=>0,solid:b=>b?.boundingBox==='block',hazardous:()=>false,
 protectedBase:()=>false,ui:{},radar:{setTarget:()=>{}}}
;(async()=>{
 const miner=require(path.join(root,'iron-skills'))(bot,skills)
 const observation=await miner.handle({command:'mining_candidates',resource:'diamond'})
 assert.equal(observation.candidates.length,2)
 await assert.rejects(miner.handle({command:'mining_select',resource:'diamond',target_id:'invented'}),/небезопасна/)
 await assert.rejects(miner.handle({command:'mining_select',resource:'iron',target_id:observation.candidates[0].id}),/устарели/)
 const chosen=observation.candidates.find(c=>c.position.x===far.x)
 lava=true
 await assert.rejects(miner.handle({command:'mining_select',resource:'diamond',target_id:chosen.id}),/небезопасна/)
 lava=false
 const accepted=await miner.handle({command:'mining_select',resource:'diamond',target_id:chosen.id})
 assert(accepted.accepted)
 assert.equal(skills.ui.qwenPlanner.target,chosen.id)
 assert.equal((await miner.handle({command:'mining_candidates',resource:'diamond'})).active,true)
 console.log('PASS: candidate IDs, resource binding, lava revalidation, executed Qwen target, no repeated planning of active vein')
})().catch(error=>{console.error(error);process.exitCode=1})
