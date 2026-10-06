const assert=require('node:assert/strict'),path=require('node:path')
const root=path.resolve(__dirname,'..'),{Vec3}=require(path.join(root,'node_modules/vec3'))
const registry=require(path.join(root,'node_modules/prismarine-registry'))('1.20.1')
const Block=require(path.join(root,'node_modules/prismarine-block'))(registry)
const natural=new Vec3(6,20,0)
let status='success',items=[{name:'diamond_pickaxe',count:1},{name:'water_bucket',count:1},{name:'lava_bucket',count:1},{name:'cobblestone',count:30}]
const bot={registry,entity:{position:new Vec3(.5,20,.5)},health:20,food:20,game:{dimension:'overworld'},entities:{},
 inventory:{items:()=>items},findBlocks:options=>options.matching(bot.blockAt(natural))?[natural]:[],
 pathfinder:{getPathTo:()=>({status})},blockAt:p=>{
  const b=Block.fromStateId(registry.blocksByName[p.equals(natural)?'obsidian':p.y<20?'stone':'air'].defaultState,0);b.position=p;return b
 },digTime:()=>4000,world:{raycast:()=>null}}
const skills={ui:{},limited:async p=>p,blocked:new Map(),key:p=>`${p.x},${p.y},${p.z}`,count:n=>items.filter(i=>i.name===n).reduce((s,i)=>s+i.count,0),
 solid:b=>b?.boundingBox==='block',hazardous:()=>false,protectedBase:()=>false,radar:{setTarget(){}},craft:async()=>{throw new Error('unexpected craft')}}
;(async()=>{
 const miner=require(path.join(root,'iron-skills'))(bot,skills)
 const reachable=await miner.handle({command:'mining_candidates',resource:'obsidian'})
 assert.equal(reachable.candidates[0].kind,'mine','Reachable obsidian keeps the natural mining strategy')
 status='noPath'
 const fallback=await miner.handle({command:'mining_candidates',resource:'obsidian'})
 assert.equal(fallback.candidates.length,1)
 assert.equal(fallback.candidates[0].id,'obsidian:create')
 assert.equal(fallback.candidates[0].reason,'no_safe_natural_route')
 await assert.rejects(miner.handle({command:'mining_select',resource:'diamond',target_id:'obsidian:create'}),/устарели/)
 const chosen=await miner.handle({command:'mining_select',resource:'obsidian',target_id:'obsidian:create'})
 assert.equal(chosen.strategy,'create_obsidian')
 assert.equal(skills.ui.qwenPlanner.strategy,'create_obsidian')
 await miner.handle({command:'mine_resource',resource:'obsidian'})
 assert.equal(skills.ui.obsidianFactory.phase,'water','Qwen choice must actually execute the casting skill')
 assert.equal((await miner.handle({command:'mining_candidates',resource:'obsidian'})).active,true)
 console.log('PASS: reachable natural obsidian, proven noPath fallback, resource binding, Qwen-selected casting execution, one plan per production run')
})().catch(error=>{console.error(error);process.exitCode=1})
