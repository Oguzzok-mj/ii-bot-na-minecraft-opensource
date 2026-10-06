const assert=require('node:assert/strict'),{Vec3}=require('../node_modules/vec3')
const factory=require('../loot')
let carried=0,ticks=0,metadata=true,collect=true,unsafe=false,pathFail=false,moves=[],approaches=0
const entity={id:8,name:'item',position:new Vec3(9.7,11.15,.5),getDroppedItem:()=>metadata?{name:'diamond',count:3}:null}
const bot={game:{dimension:'overworld'},entity:{position:new Vec3(.5,10,.5)},health:20,entities:{8:entity},
  inventory:{emptySlotCount:()=>30,items:()=>[]},blockAt:p=>({name:unsafe&&p.x===10?'lava':p.y<=10?'stone':'air',boundingBox:p.y<=10?'block':'empty'}),
  waitForTicks:async()=>{ticks++;if(ticks===2)metadata=true;if(collect&&bot.entity.position.distanceTo(entity.position)<1.5){carried+=3;delete bot.entities[8]}},
  pathfinder:{goto:async goal=>{moves.push(goal);if(pathFail)throw Error('No path');bot.entity.position=new Vec3(goal.x+.5,goal.y,goal.z+.5)}}}
const ui={}
const loot=factory(bot,{limited:async p=>p,count:n=>n==='diamond'?carried:0,ui,approach:async()=>{approaches++}})
;(async()=>{
  assert(await loot.pickup(['coal']),'Prioritize valuable loose diamonds even during other resource work and beyond old radius 7')
  assert.equal(carried,3);assert.equal(ui.pendingLoot,null)
  assert.equal(moves[0].y,11,'Walk on support at feet level; do not require exact fractional item position')
  carried=0;ticks=0;metadata=false;bot.entities[8]=entity;bot.entity.position=new Vec3(9.5,11,.5)
  loot.remember(['diamond'],new Vec3(9,11,0))
  assert(await loot.pickup(['diamond']));assert.equal(carried,3);assert.equal(ui.pendingLoot,null)
  carried=0;ticks=0;collect=false;metadata=true;pathFail=true;bot.entities[8]=entity;bot.entity.position=new Vec3(.5,11,.5)
  loot.remember(['diamond'],new Vec3(9,11,0))
  for(let i=0;i<3;i++){assert(await loot.pickup(['diamond']));assert(ui.pendingLoot)}
  await assert.rejects(loot.pickup(['diamond']),/ещё не подобрана/)
  assert.equal(carried,0);assert(ui.pendingLoot);assert.equal(approaches,4)
  unsafe=true;pathFail=false;moves=[];ui.pendingLoot.attempts=0
  await loot.pickup(['diamond']);assert.equal(moves.length,0,'Never approach on cells next to lava')
  const restored=factory(bot,{limited:async p=>p,count:n=>n==='diamond'?carried:0,ui,approach:async()=>{}})
  carried=3;assert(await restored.pickup(['diamond']));assert.equal(ui.pendingLoot,null)
  console.log('PASS: distant loose diamonds prioritized, feet target safe, delayed metadata handled, inventory gain required, failed pickup retained/retried, lava excluded, pending collection restored')
})().catch(error=>{console.error(error);process.exitCode=1})
