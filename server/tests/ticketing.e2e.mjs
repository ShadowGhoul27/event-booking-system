// End-to-end test. Start the server on port 5055 with ADMIN_EMAIL=a@x.com ADMIN_PASSWORD=adminpass1 HOLD_MINUTES=0.1 against an empty database, then run: node tests/ticketing.e2e.mjs
const B='http://localhost:5055/api'; let pass=0,fail=0; const ok=(c,m,x)=>{c?pass++:(fail++,console.log('FAIL',m,x!==undefined?JSON.stringify(x):''))};
async function call(m,p,tok,body,raw){const r=await fetch(B+p,{method:m,headers:{'content-type':'application/json',...(tok?{authorization:'Bearer '+tok}:{})},body:body?JSON.stringify(body):undefined});if(raw){return{s:r.status,b:Buffer.from(await r.arrayBuffer()),h:r.headers}}let j=null;try{j=await r.json()}catch{};return{s:r.status,j}}
const sleep=ms=>new Promise(r=>setTimeout(r,ms)); const hr=h=>new Date(Date.now()+h*36e5).toISOString();
const A=(await call('POST','/auth/login',null,{email:'a@x.com',password:'adminpass1'})).j.token;
const reg=async(n,role)=>{const r=(await call('POST','/auth/register',null,{name:n,email:n.toLowerCase()+'@x.com',password:'password1',role})).j; if(role==='organiser')await call('PATCH','/admin/organisers/'+r.user.id,A,{status:'approved'}); return r};
const O=await reg('Org','organiser'); const U=[]; for(const n of ['U1','U2','U3','U4','U5']) U.push(await reg(n,'attendee')); const [u1,u2,u3,u4,u5]=U;
const card={number:'4242 4242 4242 4242',expiry:'12/39',cvc:'123'};
const mk=(o,tok=O.token)=>call('POST','/events',tok,{title:'T',description:'d',venue:'V',startsAt:hr(72),endsAt:hr(74),capacity:1,category:'Technology',...o});
const avail=async id=>(await call('GET','/tickets/event/'+id+'/availability')).j;
const left=(a,n)=>a.tiers.find(t=>t.name===n).left;
const hold=(id,u,b)=>call('POST','/tickets/event/'+id+'/hold',u.token,b);

// ---- regression: free events, waitlist
let f=(await mk({capacity:1})).j; ok(f._id,'free event created',f);
ok((await call('POST','/bookings/'+f._id,u1.token)).j.booking.status==='confirmed','free book');
ok((await call('POST','/bookings/'+f._id,u2.token)).j.booking.status==='waitlisted','free waitlist');
const b1=(await call('GET','/bookings/mine',u1.token)).j[0];
await call('PATCH','/bookings/'+b1._id+'/cancel',u1.token);
ok((await call('GET','/bookings/mine',u2.token)).j[0].status==='confirmed','waitlist promoted');

// ---- tier validation
ok((await mk({tiers:[{name:'A',price:1,limit:1},{name:'a',price:1,limit:1}]})).s===400,'dup tier names');
ok((await mk({tiers:[{name:'A',price:-1,limit:1}]})).s===400,'neg price');
ok((await mk({tiers:[{name:'A',price:1,limit:0}]})).s===400,'zero limit');
ok((await mk({tiers:[{name:'A',price:1,limit:1,saleEndsAt:hr(100)}]})).s===400,'sale ends after start');
ok((await mk({tiers:Array.from({length:7},(_,i)=>({name:'T'+i,price:1,limit:1}))})).s===400,'7 tiers');
ok((await mk({seating:{enabled:true,rows:3,seatsPerRow:4},tiers:[{name:'A',price:1,rows:1}]})).s===400,'rows mismatch');
ok((await mk({seating:{enabled:true,rows:27,seatsPerRow:4},tiers:[{name:'A',price:1,rows:27}]})).s===400,'27 rows');
ok((await mk({seating:{enabled:true,rows:2,seatsPerRow:4}})).s===400,'seating without tiers');

// ---- GA tiers
const ga=(await mk({tiers:[{name:'Regular',price:10,limit:3},{name:'VIP',price:25,limit:1},{name:'Early Bird',price:5,limit:2,saleEndsAt:hr(24)}],offersCertificate:true})).j;
ok(ga.capacity===6&&ga.tiers.length===3,'capacity = sum of limits',ga.capacity);
const vip=ga.tiers.find(t=>t.name==='VIP'), reg_=ga.tiers.find(t=>t.name==='Regular');
ok((await call('POST','/bookings/'+ga._id,u1.token)).s===400,'free booking blocked on ticket event');
let r=await hold(ga._id,u1,{tierId:reg_._id,quantity:2}); ok(r.s===201&&r.j.tickets.length===2&&r.j.total===20,'hold 2 regular',r.j);
let a=await avail(ga._id); ok(left(a,'Regular')===1,'left 1 after hold',a);
ok((await hold(ga._id,u2,{tierId:reg_._id,quantity:2})).s===409,'not enough left');
a=await avail(ga._id); ok(left(a,'Regular')===1,'failed hold changes nothing');
ok((await hold(ga._id,u1,{tierId:reg_._id,quantity:99})).s===400,'qty over max');
ok((await hold(ga._id,u1,{tierId:'bad',quantity:1})).s===400,'bad tier id');
// last VIP ticket race
const race=await Promise.all([u1,u2,u3,u4,u5].map(u=>hold(ga._id,u,{tierId:vip._id,quantity:1})));
ok(race.filter(x=>x.s===201).length===1&&race.filter(x=>x.s===409).length===4,'last VIP ticket goes to exactly one person',race.map(x=>x.s));
a=await avail(ga._id); ok(left(a,'VIP')===0,'VIP sold out');
// payment
const mineHeld=(await call('GET','/tickets/mine',u1.token)).j.filter(t=>t.status==='held'); const ids=mineHeld.filter(t=>t.tierName==='Regular').map(t=>t._id);
ok((await call('POST','/tickets/pay',u1.token,{ticketIds:ids,card:{...card,number:'4242 4242 4242 4241'}})).s===400,'bad luhn');
ok((await call('POST','/tickets/pay',u1.token,{ticketIds:ids,card:{...card,expiry:'01/20'}})).s===400,'expired card');
ok((await call('POST','/tickets/pay',u1.token,{ticketIds:ids,card:{...card,number:'4000 0000 0000 0002'}})).s===402,'declined card');
ok((await call('POST','/tickets/pay',u2.token,{ticketIds:ids,card})).s===404,'cannot pay someone else\'s hold');
r=await call('POST','/tickets/pay',u1.token,{ticketIds:ids,card}); ok(r.s===200&&r.j.total===20&&r.j.tickets.every(t=>t.status==='confirmed'&&t.paymentRef.startsWith('SIM-')),'paid 20',r.j);
ok((await call('POST','/tickets/pay',u1.token,{ticketIds:ids,card})).s===404,'cannot pay twice');
// early bird switches off on its date: create event whose early bird ends in 2s
const eb=(await mk({tiers:[{name:'Early Bird',price:5,limit:2,saleEndsAt:new Date(Date.now()+2500).toISOString()},{name:'Regular',price:9,limit:2}]})).j;
ok((await hold(eb._id,u1,{tierId:eb.tiers[0]._id,quantity:1})).s===201,'early bird on sale now');
await sleep(3000);
let ebA=await avail(eb._id); ok(ebA.tiers[0].onSale===false&&ebA.tiers[1].onSale===true,'early bird off by date',ebA.tiers);
r=await hold(eb._id,u2,{tierId:eb.tiers[0]._id,quantity:1}); ok(r.s===409,'cannot buy early bird after date',r.j);
ok((await hold(eb._id,u2,{tierId:eb.tiers[1]._id,quantity:1})).s===201,'regular still sells');

// ---- hold expiry (server runs with a short hold)
const ex=(await mk({tiers:[{name:'Reg',price:10,limit:1}]})).j;
r=await hold(ex._id,u3,{tierId:ex.tiers[0]._id,quantity:1}); ok(r.s===201,'hold for expiry test'); const exId=r.j.tickets[0]._id;
ok((await hold(ex._id,u4,{tierId:ex.tiers[0]._id,quantity:1})).s===409,'held ticket not available to others');
await sleep(Number(process.env.WAIT||7500));
a=await avail(ex._id); ok(left(a,'Reg')===1,'expired hold released',a);
ok((await call('GET','/tickets/mine',u3.token)).j.filter(t=>t.status==='held').length===0,'cart empty after expiry');
ok((await call('POST','/tickets/pay',u3.token,{ticketIds:[exId],card})).s>=400,'cannot pay expired hold');
ok((await hold(ex._id,u4,{tierId:ex.tiers[0]._id,quantity:1})).s===201,'released ticket can be held by someone else');
ok((await call('GET','/events/'+ex._id)).j.seatsBooked===1,'seatsBooked consistent');

// ---- seat map
const sm=(await mk({seating:{enabled:true,rows:3,seatsPerRow:4},tiers:[{name:'VIP',price:30,rows:1},{name:'Regular',price:12,rows:2}]})).j;
ok(sm.capacity===12&&sm.tiers[0].limit===4,'seated capacity',sm.capacity);
ok((await hold(sm._id,u1,{seats:['Z9']})).s===400,'seat does not exist'); ok((await hold(sm._id,u1,{seats:['A5']})).s===400,'seat number too high'); ok((await hold(sm._id,u1,{seats:['A1','A1']})).s===400,'duplicate seat');
ok((await hold(sm._id,u1,{tierId:sm.tiers[0]._id,quantity:1})).s===400,'seated event needs seat labels');
const seatRace=await Promise.all([u1,u2,u3,u4,u5].map(u=>hold(sm._id,u,{seats:['A1']})));
ok(seatRace.filter(x=>x.s===201).length===1,'one winner for the same seat',seatRace.map(x=>x.s));
a=await avail(sm._id); ok(a.taken.length===1&&a.taken[0]==='A1','taken seat reported',a.taken);
r=await hold(sm._id,u2,{seats:['A1','B2']}); ok(r.s===409,'multi-seat hold fails whole when one is taken'); a=await avail(sm._id); ok(!a.taken.includes('B2')&&left(a,'Regular')===8,'nothing left half-held',a);
r=await hold(sm._id,u2,{seats:['A2','B1']}); ok(r.s===201&&r.j.tickets[0].tierName==='VIP'&&r.j.tickets[1].tierName==='Regular'&&r.j.total===42,'seat tier by row, total',r.j.total);

// ---- group booking with pay links
const g=(await mk({tiers:[{name:'Reg',price:15,limit:10}]})).j;
r=await hold(g._id,u1,{tierId:g.tiers[0]._id,quantity:3}); const gt=r.j.tickets; ok(gt.length===3&&gt.every(t=>t.payToken),'group of 3 with pay links');
let pl=await call('GET','/tickets/pay/'+gt[0].payToken); ok(pl.s===200&&pl.j.price===15&&pl.j.requestedBy==='U1'&&pl.j.event.title==='T','pay link view',pl.j);
ok((await call('GET','/tickets/pay/nope')).s===404,'bad link');
ok((await call('POST','/tickets/pay/'+gt[0].payToken,null,{card})).s===401,'pay link needs login');
r=await call('POST','/tickets/pay/'+gt[0].payToken,u2.token,{card}); ok(r.s===200&&String(r.j.ticket.ownerId)===u2.user.id,'friend pays own part and owns ticket',r.j);
ok((await call('POST','/tickets/pay/'+gt[0].payToken,u3.token,{card})).s===409,'link already paid');
ok((await call('GET','/notifications',u1.token)).j.some?.(n=>/U2 paid/.test(n.message))||JSON.stringify((await call('GET','/notifications',u1.token)).j).includes('U2 paid'),'booker notified');
ok((await call('POST','/tickets/pay',u1.token,{ticketIds:[gt[1]._id,gt[2]._id],card})).s===200,'booker pays the rest');
ok((await call('GET','/tickets/mine',u2.token)).j.some(t=>String(t._id)===gt[0]._id&&t.status==='confirmed'),'friend sees ticket');

// ---- conflicts
const c1=(await mk({tiers:[{name:'R',price:0,limit:5}],startsAt:hr(100),endsAt:hr(102)})).j;
const c2=(await mk({startsAt:hr(101),endsAt:hr(103),capacity:5})).j; const c3=(await mk({startsAt:hr(110),endsAt:hr(111),capacity:5})).j;
r=await hold(c1._id,u5,{tierId:c1.tiers[0]._id,quantity:1}); await call('POST','/tickets/pay',u5.token,{ticketIds:[r.j.tickets[0]._id],card:{}});
let cf=await call('GET','/tickets/conflicts/'+c2._id,u5.token); ok(cf.j.conflicts.length===1&&cf.j.conflicts[0]._id===c1._id,'overlap warns',cf.j);
ok((await call('GET','/tickets/conflicts/'+c3._id,u5.token)).j.conflicts.length===0,'no overlap, no warning');
await call('POST','/bookings/'+c2._id,u4.token); ok((await call('GET','/tickets/conflicts/'+c1._id,u4.token)).j.conflicts.length===1,'free booking also conflicts');
const c4=(await mk({tiers:[{name:'R',price:0,limit:5}],startsAt:hr(102),endsAt:hr(104)})).j; ok((await call('GET','/tickets/conflicts/'+c4._id,u5.token)).j.conflicts.length===0,'touching events are not a conflict');

// ---- transfer
const myGa=(await call('GET','/tickets/mine',u1.token)).j.filter(t=>t.status==='confirmed'&&t.eventId._id===ga._id); const tk=myGa[0];
ok((await call('POST','/tickets/'+tk._id+'/transfer',u1.token,{email:'u1@x.com'})).s===400,'transfer to self');
ok((await call('POST','/tickets/'+tk._id+'/transfer',u1.token,{email:'nobody@x.com'})).s===404,'unknown email');
ok((await call('POST','/tickets/'+tk._id+'/transfer',u1.token,{email:'org@x.com'})).s===404,'cannot send to organiser');
ok((await call('POST','/tickets/'+tk._id+'/transfer',u2.token,{email:'u3@x.com'})).s===404,'only the owner can send');
r=await call('POST','/tickets/'+tk._id+'/transfer',u1.token,{email:' U3@x.com '}); ok(r.s===200&&String(r.j.ticket.ownerId)===u3.user.id&&r.j.ticket.code!==tk.code,'transfer ok, new code',r.j);
ok(!(await call('GET','/tickets/mine',u1.token)).j.some(t=>t._id===tk._id),'old owner lost it');
ok(JSON.stringify((await call('GET','/notifications',u3.token)).j).includes('sent you a ticket'),'recipient notified');
ok((await call('POST','/tickets/'+tk._id+'/transfer',u1.token,{email:'u4@x.com'})).s===404,'cannot send it again');

// ---- organiser view, check-in, live counter
let at=(await call('GET','/events/'+ga._id+'/attendees',O.token)).j; ok(at.length===2&&at.some(x=>x.userId.name==='U3'),'attendees show ticket owners',at.length);
let lv=(await call('GET','/events/'+ga._id+'/live',O.token)).j; ok(lv.checkedIn===0&&lv.total===2,'live 0 of 2',lv);
ok((await call('GET','/events/'+ga._id+'/live',u1.token)).s===403,'live is organiser only');
const newCode=(await call('GET','/tickets/mine',u3.token)).j.find(t=>t._id===tk._id).code;
ok((await call('PATCH','/events/'+ga._id+'/checkin/'+tk.code,O.token,{})).s===404,'old QR code is dead');
r=await call('PATCH','/events/'+ga._id+'/checkin/'+newCode,O.token,{}); ok(r.s===200,'check in by QR code',r.j);
ok((await call('PATCH','/events/'+ga._id+'/checkin/'+newCode,O.token,{})).s===409,'duplicate scan');
ok((await call('POST','/tickets/'+tk._id+'/transfer',u3.token,{email:'u4@x.com'})).s===400,'used ticket cannot be sent');
ok((await call('PATCH','/tickets/'+tk._id+'/cancel',u3.token)).s===400,'used ticket cannot be cancelled');
lv=(await call('GET','/events/'+ga._id+'/live',O.token)).j; ok(lv.checkedIn===1&&lv.total===2,'live 1 of 2',lv);
const other=at.find(x=>x.userId.name!=='U3'); r=await call('PATCH','/events/'+ga._id+'/checkin/'+other._id,O.token,{}); ok(r.s===200,'check in by row id',r.j);
lv=(await call('GET','/events/'+ga._id+'/live',O.token)).j; ok(lv.checkedIn===2,'live 2 of 2');
ok((await call('PATCH','/events/'+ga._id+'/checkin/'+other._id,O.token,{checkedIn:false})).s===200,'undo');
let st=(await call('GET','/events/mine/stats',O.token)).j; ok(st.totals.revenue>=0&&st.totals.checkedIn>=1,'stats has revenue',st.totals);
const exp=(20+15*3+0); ok(st.totals.revenue===exp+0,'revenue exactly',st.totals.revenue);
const csv=(await call('GET','/events/'+ga._id+'/attendees.csv',O.token,null,true)).b.toString(); ok(csv.includes('Regular')&&csv.includes('U3'),'csv has tickets');

// ---- cancel & refund
const sm2=(await call('GET','/tickets/mine',u2.token)).j.filter(t=>t.eventId._id===sm._id);
r=await call('POST','/tickets/pay',u2.token,{ticketIds:sm2.map(t=>t._id),card}); ok(r.s===200,'pay seats');
a=await avail(sm._id); ok(a.taken.length===3,'3 seats taken');
const vipT=sm2.find(t=>t.seat==='A2'); r=await call('PATCH','/tickets/'+vipT._id+'/cancel',u2.token); ok(r.s===200&&/30\.00/.test(r.j.message),'cancel refunds',r.j);
a=await avail(sm._id); ok(!a.taken.includes('A2')&&a.taken.includes('B1'),'seat freed after cancel',a.taken);
ok((await hold(sm._id,u3,{seats:['A2']})).s===201,'freed seat can be held again');
ok((await call('GET','/tickets/mine',u2.token)).j.find(t=>t._id===vipT._id).refunded===true,'refund recorded');
// ---- tier edits
r=await call('PUT','/events/'+g._id,O.token,{tiers:[{_id:g.tiers[0]._id,name:'Reg',price:20,limit:20}]}); ok(r.s===200&&r.j.tiers[0].left===17&&r.j.capacity===20,'raise limit keeps sold count',r.j.tiers?.[0]);
ok((await call('PUT','/events/'+g._id,O.token,{tiers:[{_id:g.tiers[0]._id,name:'Reg',price:20,limit:2}]})).s===400,'limit below sold refused');
ok((await call('PUT','/events/'+g._id,O.token,{tiers:[{name:'New',price:1,limit:5}]})).s===400,'restructure refused when tickets exist');
r=await call('PUT','/events/'+c4._id,O.token,{tiers:[{name:'Solo',price:3,limit:7}]}); ok(r.s===200&&r.j.capacity===7,'restructure ok when empty',r.j);
ok((await call('PUT','/events/'+f._id,O.token,{tiers:[{name:'T',price:1,limit:5}]})).s===400,'cannot add tiers to event with bookings');
// ---- certificates
const ce=(await mk({capacity:5,offersCertificate:true,startsAt:hr(1),endsAt:hr(2)})).j; const cn=(await mk({capacity:5,startsAt:hr(1),endsAt:hr(2)})).j;
const bk=(await call('POST','/bookings/'+ce._id,u1.token)).j.booking; const bk2=(await call('POST','/bookings/'+cn._id,u1.token)).j.booking;
ok((await call('GET','/certificates/booking/'+bk._id,u1.token,null,true)).s===403,'certificate needs check-in');
await call('PATCH','/events/'+ce._id+'/checkin/'+bk._id,O.token,{}); await call('PATCH','/events/'+cn._id+'/checkin/'+bk2._id,O.token,{});
ok((await call('GET','/certificates/booking/'+bk._id,u1.token,null,true)).s===403,'certificate not before event ends');
await call('PUT','/events/'+ce._id,O.token,{startsAt:hr(-3),endsAt:hr(-2)}); await call('PUT','/events/'+cn._id,O.token,{startsAt:hr(-3),endsAt:hr(-2)});
r=await call('GET','/certificates/booking/'+bk._id,u1.token,null,true); ok(r.s===200&&r.b.slice(0,4).toString()==='%PDF'&&r.h.get('content-type')==='application/pdf'&&r.b.length>2000,'certificate PDF',r.s);
require_('fs').writeFileSync('/tmp/w/cert.pdf',r.b);
ok((await call('GET','/certificates/booking/'+bk2._id,u1.token,null,true)).s===403,'event without certificates');
ok((await call('GET','/certificates/booking/'+bk._id,u2.token,null,true)).s===404,'not your certificate');
// ---- event cancel refunds tickets
const before=await avail(ga._id); r=await call('PATCH','/events/'+ga._id+'/cancel',O.token); ok(r.s===200,'event cancelled');
const after=(await call('GET','/tickets/mine',u3.token)).j.find(t=>t._id===tk._id); ok(after.status==='cancelled'&&after.refunded===true,'tickets cancelled + refunded with event',after);
ok((await call('GET','/events/'+ga._id)).s===404,'cancelled event hidden');
console.log(`passed ${pass}, failed ${fail}`);
import fs from 'fs'; function require_(m){return fs}
