'use strict'
window.startMineFrames=({viewer,renderer,controls})=>{
  window.mineViewer=viewer
  const items=window.setupMineItems?window.setupMineItems(viewer):()=>{}
  const limit=120, interval=1000/limit
  const maximum=Math.min(devicePixelRatio||1,1.25)
  let next=performance.now(),previous=next,measured=next-interval,frames=0,slow=0,healthy=0,ratio=maximum
  let targetYaw=null,targetPitch=null,timer=null
  const original=viewer.setFirstPersonCamera.bind(viewer)
  viewer.setFirstPersonCamera=(position,yaw,pitch)=>{
    if(targetYaw===null)viewer.camera.rotation.set(pitch,yaw,0,'ZYX')
    targetYaw=yaw;targetPitch=pitch
    original(position,viewer.camera.rotation.y,viewer.camera.rotation.x)
  }
  renderer.setPixelRatio(ratio)
  function render(){
    timer=null
    if(document.hidden)return
    const now=performance.now(),elapsed=Math.min(100,now-previous)
    previous=now
    const activeControls=controls()
    if(activeControls)activeControls.update()
    else if(targetYaw!==null){
      const alpha=1-Math.exp(-elapsed/40)
      const delta=Math.atan2(Math.sin(targetYaw-viewer.camera.rotation.y),Math.cos(targetYaw-viewer.camera.rotation.y))
      viewer.camera.rotation.set(viewer.camera.rotation.x+(targetPitch-viewer.camera.rotation.x)*alpha,viewer.camera.rotation.y+delta*alpha,0,'ZYX')
    }
    viewer.update()
    items()
    renderer.render(viewer.scene,viewer.camera)
    if(window.drawEsp)window.drawEsp()
    frames++
    if(now-measured>=1000){
      const actual=frames*1000/(now-measured)
      window.mineFps=Math.round(actual)
      const field=document.getElementById('fps')
      if(field)field.textContent=`FPS: ${Math.round(actual)} · цель ${limit}`
      slow=actual<92?slow+1:0
      healthy=actual>=112?healthy+1:0
      if(slow>=2&&ratio>.5){ratio=Math.max(.5,ratio-.12);renderer.setPixelRatio(ratio);slow=0}
      if(healthy>=8&&ratio<maximum){ratio=Math.min(maximum,ratio+.08);renderer.setPixelRatio(ratio);healthy=0}
      frames=0;measured=now
    }
    next+=interval
    if(next<performance.now()-interval)next=performance.now()+interval
    timer=setTimeout(render,Math.max(0,next-performance.now()))
  }
  document.addEventListener('visibilitychange',()=>{
    if(document.hidden){if(timer!==null)clearTimeout(timer);timer=null}
    else if(timer===null){next=previous=performance.now();measured=next-interval;frames=0;render()}
  })
  render()
}
