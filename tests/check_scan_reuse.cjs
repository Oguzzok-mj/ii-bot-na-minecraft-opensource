const assert=require('node:assert/strict'),path=require('node:path')
const root=path.resolve(__dirname,'..')
const {Vec3}=require(path.join(root,'node_modules/vec3'))
const registry=require(path.join(root,'node_modules/prismarine-registry'))('1.20.1')
const Block=require(path.join(root,'node_modules/prismarine-block'))(registry)
let scans=0
const bot={registry,game:{dimension:'overworld'},health:20,food:20,entities:{},entity:{position:new Vec3(.5,-54,.5)},
 inventory:{items:()=>[{name:'diamond_pickaxe',count:1}],emptySlotCount:()=>20},
 blockAt:p=>{const b=Block.fromStateId(registry.blocksByName[p.y< -54?'stone':'air'].defaultState,0);b.position=p;return b},
 findBlocks:()=>{scans++;return []},pathfinder:{goto:async()=>{},getPathTo:()=>({status:'success'})},world:{raycast:()=>null},waitForTicks:async()=>{},digTime:()=>500}
const skills={ui:{},count:n=>n==='diamond_pickaxe'?1:0,limited:async p=>p,blocked:new Map(),key:p=>p.toString(),solid:b=>b?.boundingBox==='block',hazardous:()=>false,protectedBase:()=>false,radar:{setTarget(){}},craft:async()=>{},dig:async()=>{}}
;(async()=>{
 const miner=require(path.join(root,'iron-skills'))(bot,skills)
 const observation=await miner.handle({command:'mining_candidates',resource:'obsidian'})
 assert.equal(observation.candidates.length,0)
 const before=scans
 await miner.handle({command:'mine_resource',resource:'obsidian'})
 assert.equal(scans,before,'Do not repeat the same ore/water/lava scan inside the action after empty planning')
 bot.entity.position=new Vec3(20.5,-54,.5)
 await miner.handle({command:'mine_resource',resource:'obsidian'})
 assert(scans>before,'Movement must invalidate an old empty search')
 const ore=new Vec3(4,-54,0),original=bot.blockAt
 bot.blockAt=p=>{
  if(!p.equals(ore))return original(p)
  const b=Block.fromStateId(registry.blocksByName.redstone_ore.defaultState,0);b.position=p;return b
 }
 bot.findBlocks=options=>options.matching(bot.blockAt(ore))?[ore]:[]
 assert.equal((await miner.handle({command:'xp_resource'})).resource,'redstone','XP farming must choose an available XP ore instead of absent coal')
 console.log('PASS: empty planner search reused without extra scans; movement invalidates reuse')
})().catch(error=>{console.error(error);process.exitCode=1})
