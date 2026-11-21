const ALLOWED_ORIGINS=["https://dhyanshedu-lab.github.io","https://dhyanshedu-exam-portal.dhyanshedu.workers.dev"];
const json=(data,status,request)=>{const origin=request.headers.get("Origin")||"",headers={"Content-Type":"application/json","Cache-Control":"no-store","Vary":"Origin"};if(ALLOWED_ORIGINS.includes(origin))headers["Access-Control-Allow-Origin"]=origin;return new Response(JSON.stringify(data),{status,headers});};
const fail=(message,status,request)=>json({error:message},status,request);
const clean=(v,max=240)=>String(v??"").trim().slice(0,max);
const money=v=>Number.isSafeInteger(v)&&v>0;
const id=()=>crypto.randomUUID();
const audit=(env,actor,action,type,entity,details)=>env.DB.prepare("INSERT INTO audit_logs(id,actor_user_id,action,entity_type,entity_id,details_json) VALUES(?,?,?,?,?,?)").bind(id(),actor,action,type,entity,JSON.stringify(details||{}));

async function accountTotals(env,accountId){
  const [payments,adjustments,installments]=await Promise.all([
    env.DB.prepare("SELECT COALESCE(SUM(amount_paise),0) total FROM fee_transactions WHERE fee_account_id=? AND status='recorded'").bind(accountId).first(),
    env.DB.prepare("SELECT COALESCE(SUM(CASE WHEN adjustment_type IN ('credit','waiver') THEN amount_paise ELSE -amount_paise END),0) total FROM fee_adjustments WHERE fee_account_id=?").bind(accountId).first(),
    env.DB.prepare("SELECT id,installment_number,description,amount_paise,due_date,status FROM fee_installments WHERE fee_account_id=? ORDER BY installment_number").bind(accountId).all()
  ]);
  return {paid_paise:Number(payments?.total||0),adjustment_credit_paise:Number(adjustments?.total||0),installments:installments.results||[]};
}

export async function handleFeeRequest(request,env,user,account,path,method){
  const admin=account.role==="admin",student=account.role==="student";
  if(path==="/api/admin/fees/bootstrap"&&method==="GET"&&admin){
    const [students,batches,plans,classes,subjects,curricula]=await Promise.all([
      env.DB.prepare("SELECT id,full_name,email FROM users WHERE role='student' AND status='approved' AND deleted_at IS NULL ORDER BY full_name").all(),
      env.DB.prepare("SELECT b.id,b.batch_name,b.batch_type,b.class_id,b.subject_id,c.class_name,s.subject_name FROM batches b LEFT JOIN classes c ON c.id=b.class_id LEFT JOIN subjects s ON s.id=b.subject_id WHERE b.status='active' ORDER BY b.batch_name").all(),
      env.DB.prepare("SELECT id,name,amount_paise,billing_frequency,public_status FROM fee_plans WHERE is_active=1 ORDER BY name").all(),
      env.DB.prepare("SELECT id,class_name FROM classes WHERE status='active' ORDER BY class_name").all(),
      env.DB.prepare("SELECT id,subject_name FROM subjects WHERE status='active' ORDER BY subject_name").all(),
      env.DB.prepare("SELECT id,name FROM curricula WHERE status='active' ORDER BY name").all()
    ]);
    return json({success:true,students:students.results||[],batches:batches.results||[],fee_plans:plans.results||[],classes:classes.results||[],subjects:subjects.results||[],curricula:curricula.results||[]},200,request);
  }
  if(path==="/api/admin/fee-plans"&&method==="GET"&&admin){
    const rows=await env.DB.prepare("SELECT fp.*,c.class_name,s.subject_name,b.batch_name FROM fee_plans fp LEFT JOIN classes c ON c.id=fp.class_id LEFT JOIN subjects s ON s.id=fp.subject_id LEFT JOIN batches b ON b.id=fp.batch_id ORDER BY fp.created_at DESC").all();
    return json({success:true,fee_plans:rows.results||[]},200,request);
  }
  if(path==="/api/admin/fee-plans"&&method==="POST"&&admin){
    const b=await request.json().catch(()=>({})),name=clean(b.name,160),description=clean(b.description,2000)||null,amount=Number(b.amount_paise),frequency=clean(b.billing_frequency,20)||"one_time",scope=clean(b.pricing_scope,20)||"general";
    if(!name||!money(amount)||!["one_time","monthly","quarterly","term","annual"].includes(frequency)||!["general","curriculum","class","subject","batch"].includes(scope))return fail("Enter a plan name, positive amount and valid billing frequency/scope.",400,request);
    if((scope==="curriculum"&&!b.curriculum_id)||(scope==="class"&&!b.class_id)||(scope==="subject"&&!b.subject_id)||(scope==="batch"&&!b.batch_id))return fail("Select the matching curriculum, class, subject or batch for this pricing scope.",400,request);
    const idValue=id();
    try{
      await env.DB.prepare("INSERT INTO fee_plans(id,name,description,amount_paise,billing_frequency,is_active,pricing_scope,batch_type,curriculum_id,class_id,subject_id,batch_id,effective_from,effective_to,public_status,inclusions,terms,discount_type,discount_value) VALUES(?,?,?,?,?,1,?,?,?,?,?,?,?,?, 'draft',?,?,?,?)")
        .bind(idValue,name,description,amount,frequency,scope,clean(b.batch_type,20)||null,clean(b.curriculum_id,80)||null,clean(b.class_id,80)||null,clean(b.subject_id,80)||null,clean(b.batch_id,80)||null,clean(b.effective_from,20)||null,clean(b.effective_to,20)||null,clean(b.inclusions,3000)||null,clean(b.terms,3000)||null,clean(b.discount_type,20)||null,b.discount_value==null||b.discount_value===""?null:Number(b.discount_value)).run();
      await audit(env,admin.id,"fee_plan_created","fee_plan",idValue,{name,amount_paise:amount,pricing_scope:scope,public_status:"draft"}).run();
    }catch(e){return fail("Could not save fee plan. Check selected class, subject, batch and migration status. "+e.message,400,request);}
    return json({success:true,id:idValue,public_status:"draft"},201,request);
  }
  const planStatus=path.match(/^\/api\/admin\/fee-plans\/([0-9a-f-]+)\/status$/i);
  if(planStatus&&method==="PATCH"&&admin){
    const b=await request.json().catch(()=>({})),status=clean(b.status,20);
    if(!["draft","published","archived"].includes(status))return fail("Invalid fee plan status.",400,request);
    const p=await env.DB.prepare("SELECT id,effective_from,effective_to FROM fee_plans WHERE id=?").bind(planStatus[1]).first();
    if(!p)return fail("Fee plan not found.",404,request);
    if(status==="published"&&((p.effective_from&&p.effective_from>new Date().toISOString().slice(0,10))||(p.effective_to&&p.effective_to<new Date().toISOString().slice(0,10))))return fail("The plan is outside its effective date range.",409,request);
    await env.DB.batch([env.DB.prepare("UPDATE fee_plans SET public_status=? WHERE id=?").bind(status,p.id),audit(env,admin.id,"fee_plan_status_changed","fee_plan",p.id,{status})]);
    return json({success:true,status},200,request);
  }
  if(path==="/api/admin/fee-accounts"&&method==="GET"&&admin){
    const rows=await env.DB.prepare("SELECT fa.id,fa.student_id,u.full_name student_name,u.email,fa.fee_plan_id,fa.description,fa.amount_due_paise,fa.original_amount_paise,fa.discount_paise,fa.scholarship_paise,fa.due_date,fa.status,fa.created_at,fp.name plan_name,(SELECT COALESCE(SUM(ft.amount_paise),0) FROM fee_transactions ft WHERE ft.fee_account_id=fa.id AND ft.status='recorded') paid_paise,(SELECT COALESCE(SUM(CASE WHEN adj.adjustment_type IN ('credit','waiver') THEN adj.amount_paise ELSE -adj.amount_paise END),0) FROM fee_adjustments adj WHERE adj.fee_account_id=fa.id) adjustment_credit_paise FROM student_fee_accounts fa JOIN users u ON u.id=fa.student_id LEFT JOIN fee_plans fp ON fp.id=fa.fee_plan_id ORDER BY fa.created_at DESC LIMIT 500").all();
    return json({success:true,accounts:rows.results||[]},200,request);
  }
  if(path==="/api/admin/fee-accounts"&&method==="POST"&&admin){
    const b=await request.json().catch(()=>({})),studentId=clean(b.student_id,80),description=clean(b.description,240),amount=Number(b.amount_due_paise),original=Number(b.original_amount_paise??amount),discount=Number(b.discount_paise||0),scholarship=Number(b.scholarship_paise||0),due=clean(b.due_date,20)||null,planId=clean(b.fee_plan_id,80)||null,installments=Array.isArray(b.installments)?b.installments:[];
    if(!studentId||!description||!Number.isSafeInteger(amount)||amount<0||!Number.isSafeInteger(original)||original<amount||!Number.isSafeInteger(discount)||discount<0||!Number.isSafeInteger(scholarship)||scholarship<0||original-amount!==discount+scholarship||installments.length>24)return fail("Enter a student, description and valid agreed amount/discount values.",400,request);
    const s=await env.DB.prepare("SELECT id FROM users WHERE id=? AND role='student' AND status='approved' AND deleted_at IS NULL").bind(studentId).first();if(!s)return fail("Approved student not found.",404,request);
    if(planId&&!await env.DB.prepare("SELECT id FROM fee_plans WHERE id=?").bind(planId).first())return fail("Fee plan not found.",404,request);
    let sum=0;for(let i=0;i<installments.length;i++){const x=installments[i],n=Number(x.amount_paise),date=clean(x.due_date,20);if(!money(n)||!/^\d{4}-\d{2}-\d{2}$/.test(date))return fail("Each installment needs a positive amount and due date.",400,request);sum+=n;}
    if(installments.length&&sum!==amount)return fail("Installment amounts must add up exactly to the agreed fee.",400,request);
    const accountId=id(),statements=[env.DB.prepare("INSERT INTO student_fee_accounts(id,student_id,fee_plan_id,description,amount_due_paise,due_date,status,created_by,original_amount_paise,discount_paise,scholarship_paise,agreed_on,notes) VALUES(?,?,?,?,?,?, 'pending',?,?,?,?,datetime('now'),?)").bind(accountId,studentId,planId,description,amount,due,admin.id,original,discount,scholarship,clean(b.notes,2000)||null)];
    installments.forEach((x,i)=>statements.push(env.DB.prepare("INSERT INTO fee_installments(id,fee_account_id,installment_number,description,amount_paise,due_date) VALUES(?,?,?,?,?,?)").bind(id(),accountId,i+1,clean(x.description,160)||("Installment "+(i+1)),Number(x.amount_paise),clean(x.due_date,20))));
    statements.push(audit(env,admin.id,"student_fee_account_created","student_fee_account",accountId,{student_id:studentId,amount_due_paise:amount,discount_paise:discount,scholarship_paise:scholarship,installments:installments.length}));
    await env.DB.batch(statements);
    return json({success:true,id:accountId},201,request);
  }
  const payment=path.match(/^\/api\/admin\/fee-accounts\/([0-9a-f-]+)\/payments$/i);
  if(payment&&method==="POST"&&admin){
    const b=await request.json().catch(()=>({})),amount=Number(b.amount_paise),methodName=clean(b.payment_method,24)||"cash";
    if(!money(amount)||!["cash","bank_transfer","upi_manual","other"].includes(methodName))return fail("Enter a positive amount and supported manual payment method.",400,request);
    const fa=await env.DB.prepare("SELECT id,student_id,amount_due_paise FROM student_fee_accounts WHERE id=?").bind(payment[1]).first();if(!fa)return fail("Fee account not found.",404,request);
    const totals=await accountTotals(env,fa.id),balance=Number(fa.amount_due_paise)-totals.paid_paise-totals.adjustment_credit_paise;
    if(amount>balance)return fail("Payment exceeds the outstanding balance.",409,request);
    const tx=id(),receipt=id().slice(0,8).toUpperCase(),receiptNumber="DHE-"+new Date().toISOString().slice(0,10).replace(/-/g,"")+"-"+receipt;
    await env.DB.batch([
      env.DB.prepare("INSERT INTO fee_transactions(id,fee_account_id,student_id,amount_paise,payment_method,transaction_reference,status,recorded_by,notes) VALUES(?,?,?,?,?,?,'recorded',?,?)").bind(tx,fa.id,fa.student_id,amount,methodName,clean(b.transaction_reference,120)||null,admin.id,clean(b.notes,1000)||null),
      env.DB.prepare("INSERT INTO fee_receipts(id,transaction_id,receipt_number) VALUES(?,?,?)").bind(id(),tx,receiptNumber),
      env.DB.prepare("UPDATE student_fee_accounts SET status=CASE WHEN ? >= amount_due_paise THEN 'paid' WHEN ? > 0 THEN 'partial' ELSE 'pending' END WHERE id=?").bind(totals.paid_paise+amount+totals.adjustment_credit_paise,totals.paid_paise+amount,fa.id),
      audit(env,admin.id,"fee_payment_recorded","fee_transaction",tx,{fee_account_id:fa.id,amount_paise:amount,payment_method:methodName,receipt_number:receiptNumber})
    ]);
    return json({success:true,transaction_id:tx,receipt_number:receiptNumber,amount_paise:amount},201,request);
  }
  const adjustment=path.match(/^\/api\/admin\/fee-accounts\/([0-9a-f-]+)\/adjustments$/i);
  if(adjustment&&method==="POST"&&admin){
    const b=await request.json().catch(()=>({})),type=clean(b.adjustment_type,20),amount=Number(b.amount_paise),reason=clean(b.reason,500);
    if(!["credit","debit","refund","waiver"].includes(type)||!money(amount)||!reason)return fail("Choose a valid adjustment type, positive amount and reason.",400,request);
    const fa=await env.DB.prepare("SELECT id FROM student_fee_accounts WHERE id=?").bind(adjustment[1]).first();if(!fa)return fail("Fee account not found.",404,request);
    const adjustmentId=id();await env.DB.batch([env.DB.prepare("INSERT INTO fee_adjustments(id,fee_account_id,adjustment_type,amount_paise,reason,reference,created_by) VALUES(?,?,?,?,?,?,?)").bind(adjustmentId,fa.id,type,amount,reason,clean(b.reference,120)||null,admin.id),audit(env,admin.id,"fee_adjustment_recorded","fee_adjustment",adjustmentId,{fee_account_id:fa.id,adjustment_type:type,amount_paise:amount,reason})]);
    return json({success:true},201,request);
  }

  const receiptMatch=path.match(/^\/api\/fee-receipts\/([0-9a-f-]+)$/i);
  if(receiptMatch&&method==="GET"&&(admin||student)){
    const receipt=await env.DB.prepare("SELECT fr.receipt_number,fr.issued_at,ft.amount_paise,ft.payment_method,ft.transaction_reference,fa.description,fa.amount_due_paise,u.full_name,u.email FROM fee_receipts fr JOIN fee_transactions ft ON ft.id=fr.transaction_id JOIN student_fee_accounts fa ON fa.id=ft.fee_account_id JOIN users u ON u.id=ft.student_id WHERE fr.id=? AND ft.status='recorded' AND (?='admin' OR ft.student_id=?)").bind(receiptMatch[1],account.role,user.id).first();
    if(!receipt)return fail("Receipt not found or access denied.",404,request);
    const esc=v=>String(v??"").replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
    const html="<!doctype html><html><head><meta charset='utf-8'><title>"+esc(receipt.receipt_number)+"</title><style>body{font:16px Arial,sans-serif;max-width:720px;margin:40px auto;padding:24px;color:#18243a}h1{color:#0f2140}table{width:100%;border-collapse:collapse;margin-top:24px}td{padding:12px;border-bottom:1px solid #ddd}.total{font-size:22px;font-weight:bold}.muted{color:#667}</style></head><body><h1>DhyanshEdu</h1><p>Payment receipt</p><h2>"+esc(receipt.receipt_number)+"</h2><p>Student: "+esc(receipt.full_name)+" ("+esc(receipt.email)+")</p><table><tr><td>Description</td><td>"+esc(receipt.description)+"</td></tr><tr><td>Payment date</td><td>"+esc(receipt.issued_at)+"</td></tr><tr><td>Method</td><td>"+esc(receipt.payment_method)+"</td></tr><tr><td>Reference</td><td>"+esc(receipt.transaction_reference||"—")+"</td></tr><tr><td class='total'>Amount received</td><td class='total'>₹"+(Number(receipt.amount_paise)/100).toFixed(2)+"</td></tr></table><p class='muted'>This receipt confirms the manual payment recorded by DhyanshEdu.</p><button onclick='window.print()'>Print receipt</button></body></html>";
    const origin=request.headers.get("Origin")||"",headers={"Content-Type":"text/html; charset=utf-8","Cache-Control":"private, no-store","Vary":"Origin"};if(ALLOWED_ORIGINS.includes(origin))headers["Access-Control-Allow-Origin"]=origin;
    return new Response(html,{status:200,headers});
  }
  if(path==="/api/student/fees"&&method==="GET"&&student){
    const rows=await env.DB.prepare("SELECT fa.id,fa.description,fa.amount_due_paise,fa.due_date,fa.status,fa.created_at,fp.name plan_name,(SELECT COALESCE(SUM(ft.amount_paise),0) FROM fee_transactions ft WHERE ft.fee_account_id=fa.id AND ft.status='recorded') paid_paise,(SELECT COALESCE(SUM(CASE WHEN adj.adjustment_type IN ('credit','waiver') THEN adj.amount_paise ELSE -adj.amount_paise END),0) FROM fee_adjustments adj WHERE adj.fee_account_id=fa.id) adjustment_credit_paise FROM student_fee_accounts fa LEFT JOIN fee_plans fp ON fp.id=fa.fee_plan_id WHERE fa.student_id=? ORDER BY fa.created_at DESC").bind(user.id).all();
    const accounts=rows.results||[];
    for(const a of accounts){
      const [transactions,installments]=await Promise.all([
        env.DB.prepare("SELECT ft.amount_paise,ft.payment_method,ft.transaction_reference,ft.received_at,fr.id receipt_id,fr.receipt_number FROM fee_transactions ft LEFT JOIN fee_receipts fr ON fr.transaction_id=ft.id WHERE ft.fee_account_id=? AND ft.status='recorded' ORDER BY ft.received_at DESC").bind(a.id).all(),
        env.DB.prepare("SELECT installment_number,description,amount_paise,due_date,status FROM fee_installments WHERE fee_account_id=? ORDER BY installment_number").bind(a.id).all()
      ]);
      a.transactions=transactions.results||[];a.installments=installments.results||[];
    }
    return json({success:true,accounts},200,request);
  }
  return null;
}
