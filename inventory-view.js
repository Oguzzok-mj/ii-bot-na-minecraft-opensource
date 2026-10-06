'use strict';
(()=>{
  const panel=document.getElementById('inventory'),slots=document.getElementById('slots'),armor=document.getElementById('armor')
  const names={diamond:'Алмаз',coal:'Уголь',lapis_lazuli:'Лазурит',raw_iron:'Сырое железо',raw_gold:'Сырое золото',raw_copper:'Сырая медь',iron_ingot:'Железо',gold_ingot:'Золото',ancient_debris:'Древние обломки',netherite_scrap:'Обломок незерита',netherite_ingot:'Незерит',cobblestone:'Булыжник',cobbled_deepslate:'Глубинный сланец',dirt:'Земля',stick:'Палки',crafting_table:'Верстак',netherite_upgrade_smithing_template:'Шаблон улучшения'}
  const label=item=>names[item.name]||item.label||item.name.replaceAll('_',' ')
  let opened=false,last=''
  window.setMineInventory=value=>{opened=Boolean(value);panel.hidden=!opened;return opened}
  window.toggleMineInventory=()=>window.setMineInventory(!opened)
  document.getElementById('inventoryClose').onclick=()=>window.setMineInventory(false)
  document.addEventListener('keydown',event=>{
    if(event.target.matches('input,textarea'))return
    if(event.code==='KeyE'){event.preventDefault();window.toggleMineInventory()}
    if(event.code==='Escape')window.setMineInventory(false)
  })
  function slot(item,index,active){
    const cell=document.createElement('div');cell.className='slot'+(active?' selected':'')
    cell.setAttribute('aria-label',item?`${label(item)}: ${item.count}`:`Пустой слот ${index+1}`)
    if(!item)return cell
    cell.title=[label(item),item.remaining!=null?`Прочность: ${item.remaining}`:'',...(item.enchants||[]).map(e=>`${e.name} ${e.lvl}`)].filter(Boolean).join('\n')
    const image=document.createElement('img');image.src=`/api/item-texture/${encodeURIComponent(item.name)}`;image.alt='';image.onerror=()=>image.remove()
    const name=document.createElement('span');name.className='name';name.textContent=label(item)
    const count=document.createElement('b');count.textContent=item.count>1?item.count:''
    cell.append(image,name,count)
    return cell
  }
  window.updateMineInventory=state=>{
    window.mineInventoryState=state
    if(!opened)return
    const key=JSON.stringify([state.inventory,state.armorSlots,state.selected])
    if(key===last)return
    last=key
    const items=state.inventory||[]
    slots.replaceChildren(...Array.from({length:36},(_,i)=>slot(items[i],i,i>=27&&i-27===state.selected)))
    armor.replaceChildren(...Array.from({length:4},(_,i)=>slot(state.armorSlots?.[i],i,false)))
    document.getElementById('inventoryMeta').textContent=`${items.filter(Boolean).length}/36 · броня`
  }
  const set=window.setMineInventory
  window.setMineInventory=value=>{const result=set(value);if(result&&window.mineInventoryState){last='';window.updateMineInventory(window.mineInventoryState)}return result}
})()
