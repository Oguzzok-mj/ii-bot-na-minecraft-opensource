const assert=require('node:assert/strict'),{EventEmitter}=require('node:events')
const {Vec3}=require('../node_modules/vec3')
const bot=new EventEmitter(),feet=new Vec3(2,47,-34),target=new Vec3(1,48,-34)
let ceiling=false,lava=false,controls={}
Object.assign(bot,{health:20,entity:{position:feet.offset(.3,0,.4)},pathfinder:{goal:true},setControlState:(k,v)=>{controls[k]=v},
  blockAt:p=>({name:lava&&p.equals(target.offset(0,0,1))?'lava':ceiling&&p.equals(feet.offset(0,2,0))?'stone':'air',boundingBox:p.equals(target.offset(0,-1,0))?'block':'empty'})})
const next=target.offset(.5,0,.5);next.toBreak=[];next.toPlace=[]
require('../safe-step')(bot)
bot.emit('path_update',{path:[next]});bot.emit('physicsTick')
assert.equal(controls.jump,true);assert.equal(controls.forward,true);assert.equal(controls.sprint,false)
for(const condition of ['ceiling','lava','dig','noGoal','activeDig','activeMining','placing']){
  controls={};ceiling=condition==='ceiling';lava=condition==='lava';next.toBreak=condition==='dig'?[target]:[];bot.pathfinder.goal=condition!=='noGoal'
  bot.targetDigBlock=condition==='activeDig'?target:null
  bot.pathfinder.isBuilding=()=>condition==='placing'
  bot.pathfinder.isMining=()=>condition==='activeMining'
  bot.emit('physicsTick');assert.deepEqual(controls,{})
}
console.log('PASS: clear supported one-block step receives jump; blocked ceiling, lava, pending dig, or cancelled goal never forced')
