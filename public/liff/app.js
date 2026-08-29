/* global liff, LIFF_CONFIG */
const params = new URLSearchParams(location.search);
const view = params.get('view') || (params.get('billId') ? 'detail' : 'create');

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
  if (view === 'detail') return initDetail();
  return initCreate();
}

/* ---------- 1. หน้าสร้างบิล ---------- */
function initCreate() {
  const form = $('create-view');
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
      done('สร้างบิลแล้ว! การ์ดเชิญเข้าร่วมส่งเข้ากลุ่มเรียบร้อยแล้ว');
    } catch (err) {
      $('create-submit').disabled = false;
      fail('สร้างบิลไม่สำเร็จ: ' + err.message);
    }
  });

  show('create-view');
}

/* ---------- 2. หน้าปิดรับ & จัดการยอด ---------- */
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
    // หากปิดรับไปแล้ว ให้เปลี่ยนไปหน้า detail
    location.href = `?view=detail&billId=${billId}`;
    return;
  }

  const form = $('manage-view');
  $('manage-title').textContent = `บิล: ${bill.title}` + (bill.totalBaht ? ` • ยอดรวม ${bill.totalBaht} บ.` : '');
  $('pcount').textContent = bill.participants.length;

  const render = () => {
    const custom = form.mSplit.value === 'CUSTOM';
    const box = $('participants');
    box.innerHTML = '';
    if (bill.participants.length === 0) {
      box.innerHTML = '<p class="muted">ยังไม่มีคนเข้าร่วม — ให้สมาชิกเปิด LIFF เพื่อกด "เข้าร่วมบิล" ก่อน</p>';
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
      done('ปิดรับและส่งบิลเข้ากลุ่มเรียบร้อยแล้ว!');
    } catch (err) {
      $('manage-submit').disabled = false;
      fail('ปิดรับไม่สำเร็จ: ' + err.message);
    }
  });

  show('manage-view');
}

/* ---------- 3. หน้าดูรายละเอียด & ดำเนินการ (Detail View) ---------- */
async function initDetail() {
  const billId = params.get('billId');
  if (!billId) return fail('ไม่พบรหัสบิล');

  let data;
  try {
    const res = await fetch(`/api/bills/${billId}/detail`, {
      headers: { Authorization: 'Bearer ' + accessToken },
    });
    data = await res.json();
    if (!res.ok) throw new Error(data.error || 'not found');
  } catch (e) {
    return fail('โหลดข้อมูลบิลไม่สำเร็จ: ' + e.message);
  }

  // 1. Render Header Card
  $('detail-title').textContent = data.title;
  $('detail-owner-name').textContent = `โดย: ${data.ownerName}`;
  $('detail-note').textContent = data.note ? `📝 ${data.note}` : '';

  const statusBadge = $('detail-status-badge');
  if (data.status === 'OPEN_JOIN') {
    statusBadge.textContent = '📢 เปิดรับเข้าร่วม';
    statusBadge.className = 'badge warning';
  } else if (data.status === 'ACTIVE') {
    statusBadge.textContent = '💰 กำลังเรียกเก็บ';
    statusBadge.className = 'badge primary';
  } else if (data.status === 'DONE') {
    statusBadge.textContent = '🎉 เก็บเงินครบแล้ว';
    statusBadge.className = 'badge success';
  } else {
    statusBadge.textContent = data.status;
    statusBadge.className = 'badge';
  }

  let metaText = '';
  if (data.splitMode === 'EQUAL' && data.totalBaht) {
    metaText += `ยอดรวม: ${data.totalBaht} บาท (หารเท่ากัน)`;
  } else if (data.splitMode === 'CUSTOM') {
    metaText += `การแบ่งยอด: กำหนดเอง`;
  }
  if (data.currentCycle) {
    metaText += ` • รอบที่ ${data.currentCycle.cycleNo} (ครบกำหนด ${data.currentCycle.dueDate})`;
  }
  $('detail-meta').textContent = metaText;

  // 2. Render Section: OPEN_JOIN
  if (data.status === 'OPEN_JOIN') {
    $('section-join').hidden = false;
    $('section-payment').hidden = true;
    $('section-my-pay').hidden = true;
    $('section-charges-list').hidden = true;

    $('detail-pcount').textContent = data.participants.length;
    const pBox = $('detail-participants-list');
    pBox.innerHTML = '';
    if (data.participants.length === 0) {
      pBox.innerHTML = '<p class="muted">ยังไม่มีคนเข้าร่วม</p>';
    } else {
      data.participants.forEach((p) => {
        const item = document.createElement('div');
        item.className = 'p-chip';
        const avatar = p.pictureUrl ? `<img class="p-avatar-sm" src="${p.pictureUrl}" />` : '';
        item.innerHTML = `${avatar} <span>${escapeHtml(p.displayName)}</span>`;
        pBox.appendChild(item);
      });
    }

    const isParticipant = data.currentUser?.isParticipant;
    const isOwner = data.currentUser?.isOwner;

    const btnJoin = $('btn-join');
    if (isParticipant) {
      btnJoin.textContent = '✅ คุณเข้าร่วมบิลนี้แล้ว';
      btnJoin.disabled = true;
      btnJoin.className = 'btn outline';
    } else {
      btnJoin.textContent = '🙋 เข้าร่วมบิลนี้';
      btnJoin.disabled = false;
      btnJoin.className = 'btn primary';
      btnJoin.onclick = async () => {
        btnJoin.disabled = true;
        try {
          const res = await fetch(`/api/bills/${billId}/join`, {
            method: 'POST',
            headers: { Authorization: 'Bearer ' + accessToken },
          });
          const resData = await res.json();
          if (!res.ok) throw new Error(resData.error || 'join failed');
          initDetail(); // Reload
        } catch (err) {
          btnJoin.disabled = false;
          alert('เข้าร่วมบิลไม่สำเร็จ: ' + err.message);
        }
      };
    }

    const btnManage = $('btn-goto-manage');
    if (isOwner) {
      btnManage.hidden = false;
      btnManage.onclick = () => {
        location.href = `?view=manage&billId=${billId}`;
      };
    } else {
      btnManage.hidden = true;
    }
  } else {
    // 3. Render Section: ACTIVE or DONE
    $('section-join').hidden = true;
    $('section-payment').hidden = false;
    $('section-charges-list').hidden = false;

    // Bank Account Info
    const bankBox = $('bank-info-box');
    bankBox.innerHTML = '';
    if (data.bankName || data.accountNumber) {
      bankBox.innerHTML = `
        <div class="bank-row"><strong>ธนาคาร:</strong> ${escapeHtml(data.bankName || '-')}</div>
        <div class="bank-row"><strong>เลขบัญชี:</strong> <span class="mono">${escapeHtml(data.accountNumber || '-')}</span></div>
        <div class="bank-row"><strong>ชื่อบัญชี:</strong> ${escapeHtml(data.accountName || '-')}</div>
      `;
    } else {
      bankBox.innerHTML = '<p class="muted text-sm">ไม่มีข้อมูลบัญชีธนาคาร</p>';
    }

    if (data.qrUrl) {
      $('qr-preview-box').hidden = false;
      $('detail-qr-img').src = data.qrUrl;
    } else {
      $('qr-preview-box').hidden = true;
    }

    // Member Payment Section
    const myCharge = data.currentUser?.myCharge;
    const secMyPay = $('section-my-pay');
    if (myCharge && data.status === 'ACTIVE') {
      secMyPay.hidden = false;
      $('my-charge-summary').innerHTML = `
        <div class="pay-amount-box">
          <span class="text-sm muted">ยอดที่คุณต้องจ่าย</span>
          <div class="big-amount">${myCharge.amountBaht} <span class="unit">บาท</span></div>
        </div>
      `;

      const formSlip = $('form-pay-slip');
      const wrapCash = $('pay-cash-wrap');
      const statusDiv = $('my-charge-status');

      if (myCharge.status === 'UNPAID') {
        formSlip.hidden = false;
        wrapCash.hidden = false;
        statusDiv.hidden = true;

        formSlip.onsubmit = async (e) => {
          e.preventDefault();
          const fileInput = $('slip-file-input');
          if (!fileInput.files[0]) return alert('กรุณาเลือกไฟล์สลิป');

          const fd = new FormData();
          fd.append('slip', fileInput.files[0]);

          $('btn-submit-slip').disabled = true;
          try {
            const res = await fetch(`/api/charges/${myCharge.id}/pay-slip`, {
              method: 'POST',
              headers: { Authorization: 'Bearer ' + accessToken },
              body: fd,
            });
            const resData = await res.json();
            if (!res.ok) throw new Error(resData.error || 'upload failed');
            initDetail();
          } catch (err) {
            $('btn-submit-slip').disabled = false;
            alert('ส่งสลิปไม่สำเร็จ: ' + err.message);
          }
        };

        $('btn-pay-cash').onclick = async () => {
          if (!confirm('ยืนยันแจ้งชำระด้วยเงินสดใช่หรือไม่?')) return;
          try {
            const res = await fetch(`/api/charges/${myCharge.id}/pay-cash`, {
              method: 'POST',
              headers: { Authorization: 'Bearer ' + accessToken },
            });
            const resData = await res.json();
            if (!res.ok) throw new Error(resData.error || 'failed');
            initDetail();
          } catch (err) {
            alert('แจ้งจ่ายเงินสดไม่สำเร็จ: ' + err.message);
          }
        };
      } else if (myCharge.status === 'PENDING') {
        formSlip.hidden = true;
        wrapCash.hidden = true;
        statusDiv.hidden = false;
        statusDiv.innerHTML = `
          <div class="alert warning">
            ⏳ แจ้งชำระเรียบร้อยแล้ว (${myCharge.method === 'SLIP' ? 'สลิปโอนเงิน' : 'เงินสด'}) — รอเจ้าของบิลตรวจสอบและยืนยัน
          </div>
        `;
      } else if (myCharge.status === 'PAID') {
        formSlip.hidden = true;
        wrapCash.hidden = true;
        statusDiv.hidden = false;
        statusDiv.innerHTML = `
          <div class="alert success">
            ✅ ยืนยันการชำระเรียบร้อยแล้ว ขอบคุณครับ!
          </div>
        `;
      }
    } else {
      secMyPay.hidden = true;
    }

    // Charges List & Owner Audit Panel
    const chargesBox = $('charges-list');
    chargesBox.innerHTML = '';
    const charges = data.currentCycle?.charges || [];

    if (charges.length === 0) {
      chargesBox.innerHTML = '<p class="muted">ไม่มีรายการเรียกเก็บ</p>';
    } else {
      const isOwner = data.currentUser?.isOwner;
      charges.forEach((c) => {
        const item = document.createElement('div');
        item.className = 'charge-card';

        let badge = '<span class="status-pill unpaid">⬜ ยังไม่จ่าย</span>';
        if (c.status === 'PAID') {
          badge = `<span class="status-pill paid">✅ ชำระแล้ว (${c.method === 'CASH' ? 'เงินสด' : 'โอน'})</span>`;
        } else if (c.status === 'PENDING') {
          badge = `<span class="status-pill pending">⏳ รอตรวจ (${c.method === 'CASH' ? 'เงินสด' : 'สลิป'})</span>`;
        }

        const avatar = c.pictureUrl ? `<img class="p-avatar-sm" src="${c.pictureUrl}" />` : '';

        let ownerActions = '';
        if (isOwner && c.status === 'PENDING') {
          let slipBtn = '';
          if (c.slipUrl) {
            slipBtn = `<button class="btn-sm outline btn-view-slip" data-url="${c.slipUrl}">📷 ดูสลิป</button>`;
          }
          ownerActions = `
            <div class="owner-audit-actions">
              ${slipBtn}
              <button class="btn-sm primary btn-approve" data-cid="${c.id}">✅ อนุมัติ</button>
              <button class="btn-sm danger btn-reject" data-cid="${c.id}">❌ ปฏิเสธ</button>
            </div>
          `;
        } else if (c.slipUrl && isOwner) {
          ownerActions = `
            <div class="owner-audit-actions">
              <button class="btn-sm outline btn-view-slip" data-url="${c.slipUrl}">📷 ดูสลิป</button>
            </div>
          `;
        }

        item.innerHTML = `
          <div class="charge-row">
            <div class="user-info">
              ${avatar}
              <span class="user-name">${escapeHtml(c.displayName)}</span>
            </div>
            <div class="charge-right">
              <span class="charge-baht">${c.amountBaht} บ.</span>
              ${badge}
            </div>
          </div>
          ${ownerActions}
        `;
        chargesBox.appendChild(item);
      });

      // Bind Event Listeners for Owner Actions
      chargesBox.querySelectorAll('.btn-view-slip').forEach((btn) => {
        btn.onclick = () => openSlipModal(btn.dataset.url);
      });

      chargesBox.querySelectorAll('.btn-approve').forEach((btn) => {
        btn.onclick = () => confirmCharge(btn.dataset.cid, true);
      });

      chargesBox.querySelectorAll('.btn-reject').forEach((btn) => {
        btn.onclick = () => confirmCharge(btn.dataset.cid, false);
      });
    }
  }

  $('btn-refresh-detail').onclick = () => initDetail();
  show('detail-view');
}

/* ---------- 4. Helper Functions & Slip Modal ---------- */
async function confirmCharge(chargeId, approve) {
  const actionText = approve ? 'อนุมัติการชำระเงิน' : 'ปฏิเสธการชำระเงิน';
  if (!confirm(`คุณต้องการ${actionText}ใช่หรือไม่?`)) return;

  try {
    const res = await fetch(`/api/charges/${chargeId}/confirm`, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ approve }),
    });
    const resData = await res.json();
    if (!res.ok) throw new Error(resData.error || 'failed');
    initDetail();
  } catch (err) {
    alert(`${actionText}ไม่สำเร็จ: ` + err.message);
  }
}

function openSlipModal(url) {
  $('modal-slip-img').src = url;
  $('slip-modal').hidden = false;
}

$('close-slip-modal').onclick = () => {
  $('slip-modal').hidden = true;
};
$('slip-modal').onclick = (e) => {
  if (e.target === $('slip-modal')) $('slip-modal').hidden = true;
};

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
