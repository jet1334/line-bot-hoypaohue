/* global liff */
/* หน้า "จดบิลทริป" — ถูกเรียกจาก app.js เมื่อ view=trip
 * ใช้ helper ที่ app.js ส่งให้: { params, getToken, show, fail, $ }
 * reuse #trip-view ใน index.html; API ที่ /api/trips/*
 */
window.initTrip = async function initTrip({ params, getToken, show, fail, $ }) {
  const LIFF_ID = (typeof LIFF_CONFIG !== 'undefined' && LIFF_CONFIG.liffId) || '';
  const groupId = params.get('groupId');
  let tripId = params.get('tripId') || params.get('tripid');

  // ---- API helper ----
  async function api(path, opts = {}) {
    const headers = { Authorization: 'Bearer ' + getToken(), ...(opts.headers || {}) };
    if (opts.body && !(opts.body instanceof FormData)) headers['Content-Type'] = 'application/json';
    const res = await fetch('/api/trips' + path, { ...opts, headers });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'เกิดข้อผิดพลาด');
    return data;
  }

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  show('trip-view');

  // ไม่มี tripId → หน้าสร้างทริป
  if (!tripId) {
    $('trip-create-form').hidden = false;
    $('trip-manage').hidden = true;
    if (!groupId) return fail('ไม่พบรหัสกลุ่ม กรุณาเปิดจากปุ่มในกลุ่มแชท');
    $('trip-create-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const title = $('trip-title').value.trim();
      if (!title) return alert('กรุณากรอกชื่อทริป');
      $('trip-create-submit').disabled = true;
      try {
        const r = await api('', {
          method: 'POST',
          body: JSON.stringify({ groupId, title, note: $('trip-note').value.trim() || undefined }),
        });
        location.href = `?view=trip&tripId=${r.tripId}`;
      } catch (err) {
        $('trip-create-submit').disabled = false;
        fail('สร้างทริปไม่สำเร็จ: ' + err.message);
      }
    });
    return;
  }

  // มี tripId → หน้าจัดการ
  $('trip-create-form').hidden = true;
  $('trip-manage').hidden = false;

  let trip = null;
  let editingItemId = null;

  async function load() {
    trip = await api('/' + tripId);
    render();
  }

  const isOpen = () => trip.status === 'OPEN';
  const isMember = () => trip.currentUser && trip.currentUser.isMember;
  const isOwner = () => trip.currentUser && trip.currentUser.isOwner;

  function render() {
    $('trip-manage-title').textContent = trip.title;
    $('trip-manage-note').textContent = trip.note || '';
    $('trip-owner-name').textContent = 'โดย ' + trip.ownerName;
    const badge = $('trip-status-badge');
    badge.textContent = trip.status === 'OPEN' ? 'กำลังจด' : trip.status === 'DONE' ? 'ปิดแล้ว' : 'ยกเลิก';

    // สมาชิก
    $('trip-mcount').textContent = trip.members.length;
    $('trip-members-list').innerHTML = trip.members
      .map((m) => `<div class="user-item">${esc(m.displayName)}${m.userId === trip.ownerId ? ' 👑' : ''}</div>`)
      .join('');

    // ปุ่ม join/add
    $('trip-btn-join').hidden = !(isOpen() && !isMember());
    $('trip-btn-additem').hidden = !(isOpen() && isMember());
    $('trip-item-form').hidden = true;
    $('trip-btn-finalize').hidden = !(isOpen() && isOwner());

    // รายการ
    $('trip-icount').textContent = trip.items.length;
    $('trip-items-list').innerHTML = trip.items.length
      ? trip.items.map(itemRow).join('')
      : '<div class="muted text-sm">ยังไม่มีรายการ</div>';

    // bind ปุ่มแก้/ลบ ต่อ item
    trip.items.forEach((it) => {
      const edit = document.getElementById('edit-' + it.id);
      const del = document.getElementById('del-' + it.id);
      if (edit) edit.onclick = () => openItemForm(it);
      if (del) del.onclick = () => removeItem(it.id);
    });
  }

  function itemRow(it) {
    const payer = it.payerName ? `👤 ${esc(it.payerName)}` : '<span class="muted">ยังไม่ระบุคนจ่าย</span>';
    const nShare = it.shares.length;
    const editable = isOpen() && isMember();
    const btns = editable
      ? `<div class="actions-group"><button id="edit-${it.id}" class="btn text-btn">✏️ แก้</button><button id="del-${it.id}" class="btn text-btn">🗑️ ลบ</button></div>`
      : '';
    return `<div class="charge-item"><div class="flex-between"><b>${esc(it.name)}</b><b>${it.priceBaht} ฿</b></div>
      <div class="text-sm muted">${payer} · ${nShare} คนร่วม</div>
      ${it.remark ? `<div class="text-sm">📝 ${esc(it.remark)}</div>` : ''}${btns}</div>`;
  }

  // ---- ฟอร์มเพิ่ม/แก้ item ----
  function openItemForm(item) {
    editingItemId = item ? item.id : null;
    $('trip-item-form').hidden = false;
    $('trip-btn-additem').hidden = true;
    $('trip-item-form-title').textContent = item ? '✏️ แก้ไขรายการ' : '➕ เพิ่มรายการ';
    $('trip-item-cancel').hidden = !item;
    $('trip-item-id').value = item ? item.id : '';
    $('trip-item-name').value = item ? item.name : '';
    $('trip-item-price').value = item ? item.priceBaht.replace(/,/g, '') : '';
    $('trip-item-remark').value = item ? item.remark || '' : '';

    // payer dropdown
    const shareMap = {};
    if (item) item.shares.forEach((s) => { shareMap[s.memberId] = s.fixedBaht; });
    $('trip-item-payer').innerHTML = trip.members
      .map((m) => `<option value="${m.memberId}"${item && item.payerId === m.memberId ? ' selected' : ''}>${esc(m.displayName)}</option>`)
      .join('');

    // shares: ทุกคน checkbox + ช่องยอดตรง
    $('trip-item-shares').innerHTML = trip.members
      .map((m) => {
        const included = item ? m.memberId in shareMap : true;
        const fixed = item && shareMap[m.memberId] ? shareMap[m.memberId].replace(/,/g, '') : '';
        return `<div class="user-item flex-between">
          <label><input type="checkbox" class="tshare-chk" data-mid="${m.memberId}"${included ? ' checked' : ''}/> ${esc(m.displayName)}</label>
          <input type="number" step="0.01" min="0" class="tshare-fixed" data-mid="${m.memberId}" placeholder="หารเท่า" value="${fixed}" style="max-width:110px" />
        </div>`;
      })
      .join('');
    $('trip-item-form').scrollIntoView({ behavior: 'smooth' });
  }

  function collectShares() {
    const shares = [];
    document.querySelectorAll('.tshare-chk').forEach((chk) => {
      if (!chk.checked) return;
      const mid = chk.dataset.mid;
      const fixedEl = document.querySelector(`.tshare-fixed[data-mid="${mid}"]`);
      const v = fixedEl && fixedEl.value.trim();
      shares.push({ memberId: mid, fixedBaht: v || null });
    });
    return shares;
  }

  $('trip-item-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = $('trip-item-name').value.trim();
    const priceBaht = $('trip-item-price').value.trim();
    if (!name || !(Number(priceBaht) > 0)) return alert('กรุณากรอกชื่อและราคาให้ถูกต้อง');
    const shares = collectShares();
    if (shares.length === 0) return alert('ต้องมีคนร่วมอย่างน้อย 1 คน');
    const body = {
      name,
      priceBaht,
      payerId: $('trip-item-payer').value,
      remark: $('trip-item-remark').value.trim() || null,
      shares,
    };
    $('trip-item-submit').disabled = true;
    try {
      if (editingItemId) {
        await api(`/${tripId}/items/${editingItemId}`, { method: 'PATCH', body: JSON.stringify(body) });
      } else {
        await api(`/${tripId}/items`, { method: 'POST', body: JSON.stringify(body) });
      }
      await load();
    } catch (err) {
      alert('บันทึกไม่สำเร็จ: ' + err.message);
    } finally {
      $('trip-item-submit').disabled = false;
    }
  });

  async function removeItem(itemId) {
    if (!confirm('ลบรายการนี้?')) return;
    try {
      await api(`/${tripId}/items/${itemId}`, { method: 'DELETE' });
      await load();
    } catch (err) {
      alert('ลบไม่สำเร็จ: ' + err.message);
    }
  }

  // ---- ปุ่มต่างๆ ----
  $('trip-btn-additem').onclick = () => openItemForm(null);
  $('trip-item-cancel').onclick = () => { $('trip-item-form').hidden = true; $('trip-btn-additem').hidden = false; };
  $('trip-btn-refresh').onclick = () => load();

  $('trip-btn-join').onclick = async () => {
    try {
      await api(`/${tripId}/join`, { method: 'POST' });
      await load();
    } catch (err) {
      alert('เข้าร่วมไม่สำเร็จ: ' + err.message);
    }
  };

  $('trip-btn-share').onclick = async () => {
    const url = `https://liff.line.me/${LIFF_ID}?view=trip&tripId=${tripId}`;
    if (liff.isApiAvailable('shareTargetPicker')) {
      try {
        await liff.shareTargetPicker([{ type: 'text', text: `มาร่วมจดบิลทริป "${trip.title}"\n${url}` }]);
        return;
      } catch (e) { /* fallthrough */ }
    }
    prompt('คัดลอกลิงก์นี้ส่งให้เพื่อน:', url);
  };

  $('trip-btn-settle').onclick = async () => {
    try {
      const s = await api(`/${tripId}/settle`);
      renderSettle(s);
    } catch (err) {
      alert('สรุปไม่สำเร็จ: ' + err.message);
    }
  };

  function renderSettle(s) {
    const per = s.perMember
      .map((m) => `<div class="flex-between"><span>${esc(m.displayName)}</span><span>จ่าย ${m.paidBaht} / ควรจ่าย ${m.owedBaht}</span></div>`)
      .join('');
    const tr = s.transfers.length
      ? s.transfers.map((t) => `<div class="charge-item">💸 <b>${esc(t.fromName)}</b> → <b>${esc(t.toName)}</b>: ${t.baht} ฿</div>`).join('')
      : '<div class="muted">✅ สมดุลแล้ว ไม่มียอดต้องโอน</div>';
    $('trip-settle-content').innerHTML = `<div class="user-list">${per}</div><div class="divider">รายการโอน</div>${tr}`;
    $('trip-settle-box').hidden = false;
    $('trip-settle-box').scrollIntoView({ behavior: 'smooth' });
  }

  $('trip-btn-finalize').onclick = async () => {
    if (!confirm('ปิดทริปและส่งสรุปเข้ากลุ่ม? หลังปิดจะแก้ไขไม่ได้')) return;
    try {
      await api(`/${tripId}/finalize`, { method: 'POST' });
      await load();
      alert('ปิดทริปแล้ว ส่งสรุปเข้ากลุ่มเรียบร้อย');
    } catch (err) {
      alert('ปิดทริปไม่สำเร็จ: ' + err.message);
    }
  };

  try {
    await load();
  } catch (err) {
    fail('โหลดข้อมูลทริปไม่สำเร็จ: ' + err.message);
  }
};
