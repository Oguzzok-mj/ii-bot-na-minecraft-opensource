const assert=require('node:assert/strict'),path=require('node:path')
const root=path.resolve(__dirname,'..')
const {Vec3}=require(path.join(root,'node_modules/vec3'))
let hazard=false,moves=0
const bot={health:20,entity:{position:new Vec3(.5,12,.5)},blockAt:p=>({name:hazard?'lava':p.y===11?'stone':'air',boundingBox:p.y===11?'block':'empty'}),
 pathfinder:{movements:{},getPathFromTo:function*(){yield {result:{status:'success'}}},goto:async goal=>{moves++;bot.entity.position=new Vec3(goal.x+.5,goal.y,goal.z+.5)}}}
const ui={},route=require(path.join(root,'mine-route'))(bot,{limited:async p=>p,ui})
const points=Array.from({length:20},(_,x)=>new Vec3(x,12,0))
;(async()=>{
 assert(await route.follow(points));assert(bot.entity.position.x>18);assert(moves<6,'Use longer safe segments rather than one block at a time')
 assert(await route.follow(points,true));assert(bot.entity.position.x<2)
 hazard=true;const before=moves;assert.equal(await route.follow(points),false);assert.equal(moves,before,'Never follow route into lava')
 hazard=false;bot.health=4;await assert.rejects(route.follow(points),/здоровье/)
 console.log('PASS: reuse shaft in both directions, skip intermediate points, reject lava and low health')
})().catch(error=>{console.error(error);process.exitCode=1})
