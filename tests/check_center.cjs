const assert=require('node:assert/strict')
const {Vec3}=require('../node_modules/vec3')
const center=require('../center-position')
let direction,forward=false,ticks=0
const bot={entity:{position:new Vec3(2.3,48,-32.889),eyeHeight:1.62},pathfinder:{setGoal:()=>{}},
  blockAt:p=>({name:p.y<48?'stone':'air',boundingBox:p.y<48?'block':'empty'}),
  clearControlStates:()=>{forward=false},lookAt:async p=>{direction=p.minus(bot.entity.position.offset(0,1.62,0)).normalize()},
  setControlState:(name,value)=>{forward=value},waitForTicks:async()=>{if(forward){bot.entity.position=bot.entity.position.plus(direction.scaled(.1));ticks++}}}
;(async()=>{
  await center(bot)
  assert(Math.hypot(bot.entity.position.x-2.5,bot.entity.position.z+32.5)<.08)
  assert.equal(forward,false);assert(ticks>0&&ticks<20)
  bot.entity.isInWater=true
  const p=bot.entity.position.clone();await center(bot);assert.deepEqual(bot.entity.position,p)
  console.log('PASS: off-center player aligned within safe floor cell before navigation; controls stopped; water positioning untouched')
})().catch(error=>{console.error(error);process.exitCode=1})
