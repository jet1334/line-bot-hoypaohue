/* global liff, LIFF_CONFIG */
const params = new URLSearchParams(location.search);
const view = params.get('view') || 'create';

const $ = (id) => document.getElementById(id);
function show(id) {
  document.querySelectorAll('.view').forEach((v) => (v.hidden = true));
  $('loading').hidden = true;
  $(id).hidden = false;
}
function fail(msg) {
  $('error-msg').textContent = msg;
  show('error');
}

let accessToken = null;

async function main() {
  try {
    await liff.init({ liffId: LIFF_CONFIG.liffId });
  } catch (e) {
    return fail('เริ่มต้น LIFF ไม่สำเร็จ: ' + e.message);
  }
  if (!liff.isLoggedIn()) {
    liff.login();
    return;
  }
  accessToken = liff.getAccessToken();

  if (view === 'manage') return initManage();
  return initCreate();
}

/* ---------- สร้างบิล ---------- */
function initCreate() {
  const form = $('create-view');
  // ตั้งวันครบกำหนดเริ่มต้น = วันนี้
  form.startDate.value = new Date().toISOString().slice(0, 10);

  const toggleTotal = () => {
    $('total-wrap').hidden = form.splitMode.value !== 'EQUAL';
  };
  form.querySelectorAll('[name=splitMode]').forEach((r) => r.addEventListener('change', toggleTotal));
  form.recurrence.addEventListener('change', () => {
    $('recur-wrap').hidden = form.recurrence.value === 'NONE';
  });
  toggleTotal();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const groupId = params.get('groupId');
    if (!groupId) return fail('ไม่พบรหัสกลุ่ม กรุณาเปิดจากปุ่มในกลุ่มแชท');

    if (form.splitMode.value === 'EQUAL' && !(Number(form.totalBaht.value) > 0)) {
      return alert('กรุณากรอกยอดรวมให้ถูกต้อง');
    }

    const fd = new FormData();
    fd.append('groupId', groupId);
    fd.append('title', form.title.value.trim());
    fd.append('note', form.note.value.trim());
    fd.append('splitMode', form.splitMode.value);
    if (form.splitMode.value === 'EQUAL') fd.append('totalBaht', form.totalBaht.value);
    fd.append('startDate', form.startDate.value);
    fd.append('recurrence', form.recurrence.value);
    fd.append('interval', form.interval.value || '1');
    if (form.recurrence.value !== 'NONE' && form.repeatCount.value) {
      fd.append('repeatCount', form.repeatCount.value);
    }
    fd.append('bankName', form.bankName.value.trim());
    fd.append('accountNumber', form.accountNumber.value.trim());
    fd.append('accountName', form.accountName.value.trim());
    if (form.qr.files[0]) fd.append('qr', form.qr.files[0]);

    $('create-submit').disabled = true;
    try {
      const res = await fetch('/api/bills', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + accessToken },
        body: fd,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || JSON.stringify(data.error) || 'error');
      done('สร้างบิลแล้ว! กลับไปที่กลุ่มเพื่อให้สมาชิกกด "เข้าร่วมบิล"');
    } catch (err) {
      $('create-submit').disabled = false;
      fail('สร้างบิลไม่สำเร็จ: ' + err.message);
    }
  });

  show('create-view');
}

/* ---------- จัดการ/ปิดรับ ---------- */
async function initManage() {
  const billId = params.get('billId');
  if (!billId) return fail('ไม่พบรหัสบิล');

  let bill;
  try {
    const res = await fetch('/api/bills/' + billId);
    bill = await res.json();
    if (!res.ok) throw new Error(bill.error || 'not found');
  } catch (e) {
    return fail('โหลดข้อมูลบิลไม่สำเร็จ: ' + e.message);
  }

  if (bill.status !== 'OPEN_JOIN') {
    return fail('บิลนี้ปิดรับสมาชิก/ส่งไปแล้ว');
  }

  const form = $('manage-view');
  $('manage-title').textContent = `บิล: ${bill.title}` + (bill.totalBaht ? ` • ยอดรวม ${bill.totalBaht} บ.` : '');
  $('pcount').textContent = bill.participants.length;

  const render = () => {
    const custom = form.mSplit.value === 'CUSTOM';
    const box = $('participants');
    box.innerHTML = '';
    if (bill.participants.length === 0) {
      box.innerHTML = '<p class="muted">ยังไม่มีคนเข้าร่วม — ให้สมาชิกกดปุ่ม "เข้าร่วมบิล" ในกลุ่มก่อน</p>';
    }
    bill.participants.forEach((p) => {
      const row = document.createElement('div');
      row.className = 'p-row';
      const avatar = p.pictureUrl ? `<img class="p-avatar" src="${p.pictureUrl}" />` : '<div class="p-avatar"></div>';
      row.innerHTML =
        avatar +
        `<span class="name">${escapeHtml(p.displayName)}</span>` +
        (custom
          ? `<input type="number" step="0.01" min="0" inputmode="decimal" data-uid="${p.userId}" placeholder="บาท" value="${p.customBaht ?? ''}" />`
          : '');
      box.appendChild(row);
    });
  };
  form.querySelectorAll('[name=mSplit]').forEach((r) => r.addEventListener('change', render));
  // ถ้าบิลไม่มียอดรวม (สร้างแบบ CUSTOM) บังคับโหมดกำหนดเอง
  if (!bill.totalBaht) {
    form.querySelector('[name=mSplit][value=CUSTOM]').checked = true;
    form.querySelector('[name=mSplit][value=EQUAL]').disabled = true;
  }
  render();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (bill.participants.length === 0) return alert('ยังไม่มีคนเข้าร่วมบิล');
    const splitMode = form.mSplit.value;
    const payload = { splitMode };
    if (splitMode === 'CUSTOM') {
      const inputs = [...form.querySelectorAll('#participants input[data-uid]')];
      const amounts = inputs.map((i) => ({ userId: i.dataset.uid, baht: i.value }));
      if (amounts.some((a) => !(Number(a.baht) >= 0) || a.baht === '')) {
        return alert('กรุณากรอกยอดให้ครบทุกคน');
      }
      payload.amounts = amounts;
    }

    $('manage-submit').disabled = true;
    try {
      const res = await fetch('/api/bills/' + billId + '/finalize', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || JSON.stringify(data.error) || 'error');
      done('ส่งบิลเข้ากลุ่มแล้ว! สมาชิกจ่ายเงินและกดปุ่มในการ์ดบิลได้เลย');
    } catch (err) {
      $('manage-submit').disabled = false;
      fail('ปิดรับไม่สำเร็จ: ' + err.message);
    }
  });

  show('manage-view');
}

function done(msg) {
  $('done-msg').textContent = msg;
  show('done');
  setTimeout(() => {
    if (liff.isInClient()) liff.closeWindow();
  }, 1800);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

main();
