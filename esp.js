'use strict'
const oreLabels={coal:'Уголь',copper:'Медь',iron:'Железо',gold:'Золото',redstone:'Редстоун',lapis:'Лазурит',diamond:'Алмаз',emerald:'Изумруд',quartz:'Кварц',ancient_debris:'Древние обломки',lava:'Лава'}
const oreColors={coal:'#aaaaaa',copper:'#ff9a61',iron:'#ffddbd',gold:'#ffe260',redstone:'#ff5353',lapis:'#668dff',diamond:'#52ffff',emerald:'#5aff95',quartz:'#fff3ed',ancient_debris:'#c39782',lava:'#ff753d'}
const kind=name=>name.replace(/^deepslate_|^nether_/,'').replace(/_ore$/,'')
const espCanvas=document.createElement('canvas')
espCanvas.id='espCanvas'
espCanvas.style.cssText='z-index:1;pointer-events:none'
document.body.append(espCanvas)
const espContext=espCanvas.getContext('2d')
let espEnabled=true, espState=null
let oreNodes=[],actorNodes=[],oreRevision=-1,projection=null,fallbackCamera=null
let oreFilter='all'
let lastPaint=0
try{espEnabled=localStorage.getItem('mine.esp')!=='false';oreFilter=localStorage.getItem('mine.oreFilter')||'all'}catch(error){}
if(el('oreFilter'))el('oreFilter').value=oreFilter
if(el('espToggle'))el('espToggle').textContent=`ESP ${espEnabled?'ВКЛ':'ВЫКЛ'}`
if(el('oreFilter'))el('oreFilter').onchange=()=>{oreFilter=el('oreFilter').value;try{localStorage.setItem('mine.oreFilter',oreFilter)}catch(error){};drawEsp()}
window.setMineESP=(enabled,filter='all')=>{espEnabled=Boolean(enabled);oreFilter=filter;drawEsp()}
async function control(command,extra={}){
  const response=await fetch('/api/control',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({command,...extra})})
  const result=await response.json()
  if(!response.ok)throw Error(result.error||'Ошибка команды')
  return result
}
if(el('xray'))el('xray').onclick=async()=>{
  el('xray').disabled=true
  try{await control('xray',{enabled:!espState?.xray})}catch(error){el('radarTarget').textContent=error.message}
  finally{el('xray').disabled=false}
}
if(el('espToggle'))el('espToggle').onclick=()=>{espEnabled=!espEnabled;try{localStorage.setItem('mine.esp',String(espEnabled))}catch(error){};el('espToggle').textContent=`ESP ${espEnabled?'ВКЛ':'ВЫКЛ'}`;drawEsp()}
if(el('pause'))el('pause').onclick=async()=>{
  try{await control('pause',{enabled:!espState?.paused})}catch(error){el('radarTarget').textContent=error.message}
}
if(el('deposit'))el('deposit').onclick=async()=>{
  try{await control('deposit',{player:el('playerName').value.trim()});el('radarTarget').textContent='Разгрузка в очереди после текущего действия'}
  catch(error){el('radarTarget').textContent=error.message}
}
function updateEsp(state){
  espState=state
  if(el('xray'))el('xray').textContent=`X-ray ${state.xray?'ВКЛ':'ВЫКЛ'}`
  if(el('pause'))el('pause').textContent=state.paused?'Продолжить':'Пауза'
  actorNodes=[...(state.players||[]).map(o=>({...o,color:'#ff88ff',label:o.name+(o.live?'':' · последняя позиция'),player:true})),
    ...(state.stashes||[]).map(o=>({...o,color:'#ffcf70',label:o.name,player:true})),
    ...(state.home&&(!state.dimension||state.dimension==='overworld')?[{position:state.home,color:'#a6cbb2',label:'Дом',player:true}]:[])]
  if(oreRevision!==state.oreRevision){
  oreRevision=state.oreRevision
  oreNodes=(state.ores||[]).map(o=>({...o,type:kind(o.name),color:oreColors[kind(o.name)]||'#fff',label:oreLabels[kind(o.name)]||o.name,group:`${o.name}:${Math.floor(o.position.x/4)},${Math.floor(o.position.y/4)},${Math.floor(o.position.z/4)}`}))
  const counts={}
  for(const ore of state.ores||[]){const type=kind(ore.name);counts[type]=(counts[type]||0)+1}
  if(el('oreCounts'))el('oreCounts').replaceChildren(...Object.entries(counts).map(([type,count])=>{
    const row=document.createElement('div');row.style.color=oreColors[type]||'white';row.textContent=`${oreLabels[type]||type}: ${count}${count>=160?'+':''}`;return row
  }))
  }
  const target=state.target
  if(el('radarTarget'))el('radarTarget').textContent=target?`Цель: ${oreLabels[kind(target.name)]||target.name} · X ${target.position.x} Y ${target.position.y} Z ${target.position.z}`:`Сканирование: ${state.scanRadius||64} м · загруженные чанки`
}
function drawEsp(){
  const now=performance.now()
  if(now-lastPaint<25)return
  lastPaint=now
  const w=innerWidth,h=innerHeight
  if(espCanvas.width!==w||espCanvas.height!==h){espCanvas.width=w;espCanvas.height=h}
  const ctx=espContext
  ctx.clearRect(0,0,w,h)
  if(!espEnabled||!espState?.position||!window.THREE)return
  const T=window.THREE,p=espState.position
  if(!projection)projection=new T.Vector3()
  if(!fallbackCamera)fallbackCamera=new T.PerspectiveCamera(75,w/h,.1,1000)
  const camera=window.mineViewer?.camera||fallbackCamera
  if(!window.mineViewer){if(camera.aspect!==w/h){camera.aspect=w/h;camera.updateProjectionMatrix()};camera.position.set(p.x,p.y+1.6,p.z);camera.rotation.set(espState.pitch,espState.yaw,0,'ZYX')}
  camera.updateMatrixWorld()
  const target=espState.target?.position
  let labels=0
  const labelled=new Set()
  for(let index=0;index<oreNodes.length+actorNodes.length;index++){
    const node=index<oreNodes.length?oreNodes[index]:actorNodes[index-oreNodes.length]
    const position=node.position
    const selected=target&&position.x===target.x&&position.y===target.y&&position.z===target.z
    if(oreFilter!=='all'&&!node.player&&!selected&&node.type!==oreFilter)continue
    projection.set(position.x+.5,position.y+(node.player?1:.5),position.z+.5).project(camera)
    if(projection.z<0||projection.z>1||Math.abs(projection.x)>1.1||Math.abs(projection.y)>1.1)continue
    let left=Infinity,top=Infinity,right=-Infinity,bottom=-Infinity,visible=true
    for(let corner=0;corner<8;corner++){
      projection.set(position.x+(corner&1),position.y+((corner>>1)&1)*(node.player?1.8:1),position.z+((corner>>2)&1)).project(camera)
      if(projection.z<0||projection.z>1){visible=false;break}
      const x=(projection.x+1)*w/2,y=(1-projection.y)*h/2
      left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y)
    }
    if(!visible)continue
    ctx.strokeStyle=selected?'#ffffff':node.color;ctx.lineWidth=selected?3:1;ctx.globalAlpha=selected||node.player?1:.65
    ctx.strokeRect(left,top,Math.max(3,right-left),Math.max(3,bottom-top))
    const distance=Math.hypot(position.x-camera.position.x,position.y-camera.position.y,position.z-camera.position.z)
    if(selected||node.player||labels<20&&distance<22&&!labelled.has(node.group)){
      labelled.add(node.group)
      ctx.globalAlpha=1;ctx.font='bold 12px Segoe UI';ctx.fillStyle=node.color;ctx.strokeStyle='#10151a';ctx.lineWidth=3
      const text=`${selected?'▶ ':''}${node.label} ${Math.round(distance)} м`
      ctx.strokeText(text,left,top-5);ctx.fillText(text,left,top-5);labels++
    }
  }
  ctx.globalAlpha=1
}
window.addEventListener('resize',drawEsp)
