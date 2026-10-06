const assert=require('node:assert/strict')
let goal='home',cleared=0
const limited=require('../with-timeout')({pathfinder:{setGoal:g=>{goal=g}},clearControlStates:()=>cleared++})
;(async()=>{
  assert.equal(await limited(Promise.resolve('inventory synchronized'),50),'inventory synchronized')
  assert.equal(goal,'home');assert.equal(cleared,0)
  assert.equal(await limited(limited(Promise.resolve('tool equipped'),50),100),'tool equipped')
  assert.equal(goal,'home');assert.equal(cleared,0)
  await assert.rejects(limited(new Promise(()=>{}),5),/слишком долго/)
  assert.equal(goal,null);assert.equal(cleared,1)
  goal='mine'
  await assert.rejects(limited(Promise.reject(new Error('dig failed')),50),/dig failed/)
  assert.equal(goal,null);assert.equal(cleared,2)
  console.log('PASS: inventory synchronization/equipment keeps active navigation; timeout or failure cancels movement')
})().catch(error=>{console.error(error);process.exitCode=1})
