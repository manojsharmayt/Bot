const config=require('../config/config');
async function api(path, method='GET', body=null, query='') {
 const ts=Math.floor(Date.now()/1000);
 const url=config.apiBase+'/bot/'+path+(query?`?${query}`:'');
 const res=await fetch(url,{method,headers:{'Content-Type':'application/json','X-API-Secret':config.apiSecret,'X-Timestamp':String(ts)},body:body?JSON.stringify(body):undefined});
 const data=await res.json().catch(()=>({}));
 if(!res.ok) throw new Error(data.error||`Dashboard API HTTP ${res.status}`);
 return data;
}
module.exports={api};
