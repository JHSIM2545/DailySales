/**
 * S1 북서울지사 영업일보 - Supabase Backend Adapter
 * Google Apps Script의 google.script.run 호출을 브라우저에서 가로채 Supabase 데이터베이스와 직접 통신합니다.
 */

(function(window) {
  'use strict';

  // --- Supabase 설정 ---
  const SUPABASE_URL = 'https://gpqlximhoqdybcewdfde.supabase.co';
  const SUPABASE_ANON_KEY = 'sb_publishable_xUnGxyLCc5TB5nv4keVQVw__grqGJkP';

  let sb = null;
  function getSupabase() {
    if (!sb && window.supabase) {
      sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    }
    return sb;
  }

  // --- 유틸리티 ---
  function getTzToday() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  function getSession_() {
    try {
      const raw = sessionStorage.getItem('s1_admin_session_v1') || sessionStorage.getItem('s1_session_v1');
      return raw ? JSON.parse(raw) : null;
    } catch(e) { return null; }
  }

  // --- 비즈니스 로직 구현체 (Code.gs 1:1 매핑) ---
  const Backend = {
    // 1. 깃발 관리
    getGlobalFlags: async function() {
      try {
        const raw = localStorage.getItem('GLOBAL_FLAGS');
        return raw ? JSON.parse(raw) : [];
      } catch(e) { return []; }
    },

    toggleGlobalFlag: async function(id, state) {
      try {
        let arr = JSON.parse(localStorage.getItem('GLOBAL_FLAGS') || '[]');
        if (state && !arr.includes(id)) arr.push(id);
        else if (!state) arr = arr.filter(x => x !== id);
        localStorage.setItem('GLOBAL_FLAGS', JSON.stringify(arr));
        return arr;
      } catch(e) { return []; }
    },

    // 2. 시트 버전 체크
    getSheetVersions: async function(token) {
      const now = Date.now();
      return { order: now, cancel: now, price: now, restart: now, productdaily: now };
    },

    // 3. 수주개시
    getOrderStartData: async function(token, yearMonth) {
      const client = getSupabase();
      if (!client) throw new Error('Supabase client not loaded');
      const { data, error } = await client.from('daily_orders').select('*').order('id', { ascending: false });
      if (error) throw error;

      const HEADERS = ['개시', '수주월', '개시월', '이월', '구분', '계약번호', '계약처명', '영업담당', '영업동기', '담당차량', '보고일', '계약일', '개시일', '기산일', '용역료', '상품', '그로스', '비고', '유형'];
      const curYM = getTzToday().slice(0, 7);

      let rows = (data || []).map(r => {
        const isStartUnknown = (!r.start_date && (r.start_ym === '미정' || r.carry_over === '미정'));
        const isBillingUnknown = (!r.billing_date && (r.start_status === '미정' || r.category === '미개시'));
        const startDisp = r.start_date || (isStartUnknown ? '미정' : '');
        const billingDisp = r.billing_date || (isBillingUnknown ? '미정' : '');
        return [
          r.start_status || '',
          r.order_ym || '',
          r.start_ym || '',
          r.carry_over || '',
          r.category || '',
          r.contract_no || '',
          r.customer_name || '',
          r.rep_name || '',
          r.sales_motive || '',
          r.car_no || '',
          r.report_date || '',
          r.contract_date || '',
          startDisp,
          billingDisp,
          r.monthly_fee != null ? Number(r.monthly_fee) : '',
          r.product_name || '',
          r.gross_type || '',
          r.note || '',
          r.reg_type || '직접등록',
          String(r.sheet_row_id || r.id)
        ];
      });

      if (yearMonth !== 'ALL') {
        rows = rows.filter(r => {
          const bDate = r[13];
          if (!bDate || bDate === '미정') return true;
          return bDate.slice(0, 7) >= curYM;
        });
      }

      return { headers: HEADERS, rows: rows };
    },

    saveOrderStartRow: async function(token, payload) {
      const client = getSupabase();
      const fields = payload.fields || {};
      const isStartUnknown = (fields['개시일'] === '미정' || !fields['개시일']);
      const isBillingUnknown = (fields['기산일'] === '미정' || !fields['기산일']);
      const today = getTzToday();
      const todayYm = today.slice(0, 7);
      const startYm = isStartUnknown ? '미정' : fields['개시일'].slice(0, 7);
      const billingYm = isBillingUnknown ? '미정' : fields['기산일'].slice(0, 7);

      const record = {
        start_status: isBillingUnknown ? '미정' : (billingYm > todayYm ? '예정' : '확정'),
        order_ym: fields['계약일'] ? fields['계약일'].slice(0, 7) : '',
        start_ym: startYm,
        carry_over: isStartUnknown ? '미정' : (startYm === todayYm ? '당월' : '이월'),
        category: isBillingUnknown ? '미개시' : (fields['기산일'] < today ? '개시' : '미개시'),
        contract_no: fields['계약번호'] || 'N',
        customer_name: fields['계약처명'] || '',
        rep_name: fields['영업담당'] || '',
        sales_motive: fields['영업동기'] || '',
        car_no: fields['담당차량'] ? String(fields['담당차량']) : '',
        report_date: fields['보고일'] || null,
        contract_date: fields['계약일'] || null,
        start_date: isStartUnknown ? null : fields['개시일'],
        billing_date: isBillingUnknown ? null : fields['기산일'],
        monthly_fee: fields['용역료'] ? Number(String(fields['용역료']).replace(/[^0-9.-]/g, '')) : null,
        product_name: fields['상품'] || '알람',
        gross_type: fields['그로스'] || '일반',
        note: fields['비고'] || '',
        reg_type: fields['유형'] || '직접등록',
        updated_at: new Date().toISOString()
      };

      if (payload.id && !String(payload.id).startsWith('tmp_')) {
        let q = client.from('daily_orders').update(record);
        if (/^\d+$/.test(String(payload.id))) q = q.eq('id', Number(payload.id));
        else q = q.eq('sheet_row_id', String(payload.id));
        const { error } = await q;
        if (error) throw error;
        return { success: true, id: payload.id };
      } else {
        record.sheet_row_id = 'row_' + Date.now();
        record.created_at = new Date().toISOString();
        const { data, error } = await client.from('daily_orders').insert([record]).select('id').single();
        if (error) throw error;
        return { success: true, id: String(data.id) };
      }
    },

    deleteOrderStartRow: async function(token, id) {
      const client = getSupabase();
      let q = client.from('daily_orders').delete();
      if (/^\d+$/.test(String(id))) q = q.eq('id', Number(id));
      else q = q.eq('sheet_row_id', String(id));
      const { error } = await q;
      if (error) throw error;
      return { success: true };
    },

    // 4. 해약중지
    getCancelData: async function(token, yearMonth) {
      const client = getSupabase();
      const { data, error } = await client.from('daily_cancels').select('*').order('id', { ascending: false });
      if (error) throw error;

      const CANCEL_HEADERS = ['구분', '기준', '해약월', '계약번호', '계약처명', '영업담당', '담당차량', '접수일', '확정일', '용역료', '상품', '그로스', '해약유형', '유형', '사유'];
      const curYM = getTzToday().slice(0, 7);

      let rows = (data || []).map(r => {
        let confirmDisp = r.confirm_date;
        if (!confirmDisp) {
          confirmDisp = (r.standard === '방어' || r.cancel_ym === '해약방어') ? '해약방어' : '미정';
        }
        return [
          r.category || '',
          r.standard || '',
          r.cancel_ym || '',
          r.contract_no || '',
          r.customer_name || '',
          r.rep_name || '',
          r.car_no || '',
          r.receipt_date || '',
          confirmDisp,
          r.monthly_fee != null ? Number(r.monthly_fee) : '',
          r.product_name || '',
          r.gross_type || '',
          r.cancel_type || '',
          r.reg_type || '직접등록',
          r.cancel_reason || '',
          String(r.sheet_row_id || r.id)
        ];
      });

      if (yearMonth !== 'ALL') {
        rows = rows.filter(r => {
          const cDate = r[8];
          if (!cDate || cDate === '미정' || cDate === '해약방어') return true;
          return cDate.slice(0, 7) >= curYM;
        });
      }

      return { headers: CANCEL_HEADERS, rows: rows };
    },

    saveCancelRow: async function(token, payload) {
      const client = getSupabase();
      const fields = payload.fields || {};
      const isDefended = (fields['확정일'] === '해약방어');
      const isUnknown = (fields['확정일'] === '미정' || !fields['확정일']);
      const confirmDateVal = (isDefended || isUnknown) ? null : fields['확정일'];
      const todayYm = getTzToday().slice(0, 7);
      const confirmYm = isDefended ? '해약방어' : (isUnknown ? '미정' : fields['확정일'].slice(0, 7));
      const standardVal = isDefended ? '방어' : (isUnknown ? '미정' : (confirmYm === todayYm ? '당월' : '이월'));
      const categoryVal = (fields['해약유형'] && fields['해약유형'].indexOf('중지') !== -1) ? '중지' : '해약';

      const record = {
        category: categoryVal,
        standard: standardVal,
        cancel_ym: confirmYm,
        contract_no: fields['계약번호'] || 'N',
        customer_name: fields['계약처명'] || '',
        rep_name: fields['영업담당'] || '',
        car_no: fields['담당차량'] ? String(fields['담당차량']) : '',
        receipt_date: fields['접수일'] || null,
        confirm_date: confirmDateVal,
        monthly_fee: fields['용역료'] ? Number(String(fields['용역료']).replace(/[^0-9.-]/g, '')) : null,
        product_name: fields['상품'] || '알람',
        gross_type: fields['그로스'] || '일반',
        cancel_type: fields['해약유형'] || '폐업',
        reg_type: fields['유형'] || '직접등록',
        cancel_reason: fields['사유'] || '',
        updated_at: new Date().toISOString()
      };

      if (payload.id && !String(payload.id).startsWith('tmp_')) {
        let q = client.from('daily_cancels').update(record);
        if (/^\d+$/.test(String(payload.id))) q = q.eq('id', Number(payload.id));
        else q = q.eq('sheet_row_id', String(payload.id));
        const { error } = await q;
        if (error) throw error;
        return { success: true, id: payload.id };
      } else {
        record.sheet_row_id = 'row_' + Date.now();
        record.created_at = new Date().toISOString();
        const { data, error } = await client.from('daily_cancels').insert([record]).select('id').single();
        if (error) throw error;
        return { success: true, id: String(data.id) };
      }
    },

    deleteCancelRow: async function(token, id) {
      const client = getSupabase();
      let q = client.from('daily_cancels').delete();
      if (/^\d+$/.test(String(id))) q = q.eq('id', Number(id));
      else q = q.eq('sheet_row_id', String(id));
      const { error } = await q;
      if (error) throw error;
      return { success: true };
    },

    // 5. 인상인하
    getPriceData: async function(token, yearMonth) {
      const client = getSupabase();
      const { data, error } = await client.from('daily_price_changes').select('*').order('id', { ascending: false });
      if (error) throw error;

      const PRICE_HEADERS = ['구분', '기준', '반영월', '계약번호', '계약처명', '영업담당', '접수자', '담당차량', '접수일', '기산일', '금액', '現용역료', '인상인하율', '사유', '상품', '그로스', '유형', '비고'];
      const curYM = getTzToday().slice(0, 7);

      let rows = (data || []).map(r => {
        const billingDisp = r.billing_date || '미정';
        return [
          r.category || '',
          r.standard || '',
          r.apply_ym || '',
          r.contract_no || '',
          r.customer_name || '',
          r.rep_name || '',
          r.receiver_name || '',
          r.car_no || '',
          r.receipt_date || '',
          billingDisp,
          r.diff_amount != null ? Number(r.diff_amount) : '',
          r.current_fee != null ? Number(r.current_fee) : '',
          r.change_rate || '',
          r.reason || '',
          r.product_name || '',
          r.gross_type || '',
          r.reg_type || '직접등록',
          r.note || '',
          String(r.sheet_row_id || r.id)
        ];
      });

      if (yearMonth !== 'ALL') {
        rows = rows.filter(r => {
          const bDate = r[9];
          if (!bDate || bDate === '미정') return true;
          return bDate.slice(0, 7) >= curYM;
        });
      }

      return { headers: PRICE_HEADERS, rows: rows };
    },

    savePriceRow: async function(token, payload) {
      const client = getSupabase();
      const fields = payload.fields || {};
      const isBillingUnknown = (fields['기산일'] === '미정' || !fields['기산일']);
      const todayYm = getTzToday().slice(0, 7);
      const applyYm = isBillingUnknown ? '미정' : fields['기산일'].slice(0, 7);
      const standardVal = isBillingUnknown ? '미정' : (applyYm === todayYm ? '당월' : '이월');
      const diffAmt = Number(String(fields['금액'] || 0).replace(/[^0-9.-]/g, ''));
      const currFee = Number(String(fields['現용역료'] || 0).replace(/[^0-9.-]/g, ''));
      const rate = (currFee && diffAmt) ? (diffAmt / currFee * 100).toFixed(1) + '%' : '';

      const record = {
        category: diffAmt < 0 ? '인하' : '인상',
        standard: standardVal,
        apply_ym: applyYm,
        contract_no: fields['계약번호'] || 'N',
        customer_name: fields['계약처명'] || '',
        rep_name: fields['영업담당'] || '',
        receiver_name: fields['접수자'] || '',
        car_no: fields['담당차량'] ? String(fields['담당차량']) : '',
        receipt_date: fields['접수일'] || null,
        billing_date: isBillingUnknown ? null : fields['기산일'],
        diff_amount: diffAmt,
        current_fee: currFee,
        change_rate: rate,
        reason: fields['사유'] || '',
        product_name: fields['상품'] || '알람',
        gross_type: fields['그로스'] || '일반',
        reg_type: fields['유형'] || '직접등록',
        note: fields['비고'] || '',
        updated_at: new Date().toISOString()
      };

      if (payload.id && !String(payload.id).startsWith('tmp_')) {
        let q = client.from('daily_price_changes').update(record);
        if (/^\d+$/.test(String(payload.id))) q = q.eq('id', Number(payload.id));
        else q = q.eq('sheet_row_id', String(payload.id));
        const { error } = await q;
        if (error) throw error;
        return { success: true, id: payload.id };
      } else {
        record.sheet_row_id = 'row_' + Date.now();
        record.created_at = new Date().toISOString();
        const { data, error } = await client.from('daily_price_changes').insert([record]).select('id').single();
        if (error) throw error;
        return { success: true, id: String(data.id) };
      }
    },

    deletePriceRow: async function(token, id) {
      const client = getSupabase();
      let q = client.from('daily_price_changes').delete();
      if (/^\d+$/.test(String(id))) q = q.eq('id', Number(id));
      else q = q.eq('sheet_row_id', String(id));
      const { error } = await q;
      if (error) throw error;
      return { success: true };
    },

    // 6. 재개시
    getRestartData: async function(token, yearMonth) {
      const client = getSupabase();
      const { data, error } = await client.from('daily_restarts').select('*').order('id', { ascending: false });
      if (error) throw error;

      const RESTART_HEADERS = ['현상태', '재개시월', '계약번호', '계약처명', '영업담당', '담당차량', '재개시일', '용역료', '중지일', '공사담당', '상품', '그로스', '비고'];
      const curYM = getTzToday().slice(0, 7);

      let rows = (data || []).map(r => {
        const restartDisp = r.restart_date || '미정';
        return [
          r.status || '중지',
          r.restart_ym || '',
          r.contract_no || '',
          r.customer_name || '',
          r.rep_name || '',
          r.car_no || '',
          restartDisp,
          r.monthly_fee != null ? Number(r.monthly_fee) : '',
          r.stop_date || '',
          r.construct_rep || '',
          r.product_name || '',
          r.gross_type || '',
          r.note || '',
          String(r.sheet_row_id || r.id)
        ];
      });

      if (yearMonth !== 'ALL') {
        rows = rows.filter(r => {
          const rDate = r[6];
          if (!rDate || rDate === '미정') return true;
          return rDate.slice(0, 7) >= curYM;
        });
      }

      return { headers: RESTART_HEADERS, rows: rows };
    },

    saveRestartRow: async function(token, payload) {
      const client = getSupabase();
      const fields = payload.fields || {};
      const isRestartUnknown = (fields['재개시일'] === '미정' || !fields['재개시일']);
      const restartYm = isRestartUnknown ? '미정' : fields['재개시일'].slice(0, 7);

      const record = {
        status: fields['현상태'] || (isRestartUnknown ? '중지' : '재개시'),
        restart_ym: restartYm,
        contract_no: fields['계약번호'] || 'N',
        customer_name: fields['계약처명'] || '',
        rep_name: fields['영업담당'] || '',
        car_no: fields['담당차량'] ? String(fields['담당차량']) : '',
        restart_date: isRestartUnknown ? null : fields['재개시일'],
        monthly_fee: fields['용역료'] ? Number(String(fields['용역료']).replace(/[^0-9.-]/g, '')) : null,
        stop_date: fields['중지일'] || null,
        construct_rep: fields['공사담당'] || '',
        product_name: fields['상품'] || '알람',
        gross_type: fields['그로스'] || '일반',
        note: fields['비고'] || '',
        updated_at: new Date().toISOString()
      };

      if (payload.id && !String(payload.id).startsWith('tmp_')) {
        let q = client.from('daily_restarts').update(record);
        if (/^\d+$/.test(String(payload.id))) q = q.eq('id', Number(payload.id));
        else q = q.eq('sheet_row_id', String(payload.id));
        const { error } = await q;
        if (error) throw error;
        return { success: true, id: payload.id };
      } else {
        record.sheet_row_id = 'row_' + Date.now();
        record.created_at = new Date().toISOString();
        const { data, error } = await client.from('daily_restarts').insert([record]).select('id').single();
        if (error) throw error;
        return { success: true, id: String(data.id) };
      }
    },

    deleteRestartRow: async function(token, id) {
      const client = getSupabase();
      let q = client.from('daily_restarts').delete();
      if (/^\d+$/.test(String(id))) q = q.eq('id', Number(id));
      else q = q.eq('sheet_row_id', String(id));
      const { error } = await q;
      if (error) throw error;
      return { success: true };
    },

    // 7. 상품일보
    getProductDailyData: async function(token) {
      const client = getSupabase();
      const { data, error } = await client.from('daily_product_reports').select('*').order('id', { ascending: false });
      if (error) throw error;

      const PRODUCT_DAILY_HEADERS = ['계약번호', '서비스제공처', '보고일', '계약담당자', '매출예상', '계약동기', '계약설치비', '계약기기비', '합계', '구분', '매출여부'];
      const rows = (data || []).map(r => [
        r.contract_no || '',
        r.customer_name || '',
        r.report_date || '',
        r.rep_name || '',
        r.sales_forecast || '',
        r.motive || '',
        r.install_fee != null ? Number(r.install_fee) : '',
        r.device_fee != null ? Number(r.device_fee) : '',
        r.total_amount != null ? Number(r.total_amount) : '',
        r.category || '',
        r.sales_status || '미매출',
        String(r.sheet_row_id || r.id)
      ]);
      return { headers: PRODUCT_DAILY_HEADERS, rows: rows };
    },

    saveProductDailyRow: async function(token, payload) {
      const client = getSupabase();
      const fields = payload.fields || {};
      const instFee = Number(String(fields['계약설치비'] || 0).replace(/[^0-9.-]/g, ''));
      const devFee = Number(String(fields['계약기기비'] || 0).replace(/[^0-9.-]/g, ''));

      const record = {
        contract_no: fields['계약번호'] || 'T',
        customer_name: fields['서비스제공처'] || '',
        report_date: fields['보고일'] || null,
        rep_name: fields['계약담당자'] || '',
        sales_forecast: fields['매출예상'] || '',
        motive: fields['계약동기'] || '',
        install_fee: instFee,
        device_fee: devFee,
        total_amount: instFee + devFee,
        category: fields['구분'] || '지사',
        sales_status: fields['매출여부'] || '미매출',
        updated_at: new Date().toISOString()
      };

      if (payload.id && !String(payload.id).startsWith('tmp_')) {
        let q = client.from('daily_product_reports').update(record);
        if (/^\d+$/.test(String(payload.id))) q = q.eq('id', Number(payload.id));
        else q = q.eq('sheet_row_id', String(payload.id));
        const { error } = await q;
        if (error) throw error;
        return { success: true, id: payload.id };
      } else {
        record.sheet_row_id = 'row_' + Date.now();
        record.created_at = new Date().toISOString();
        const { data, error } = await client.from('daily_product_reports').insert([record]).select('id').single();
        if (error) throw error;
        return { success: true, id: String(data.id) };
      }
    },

    deleteProductDailyRow: async function(token, id) {
      const client = getSupabase();
      let q = client.from('daily_product_reports').delete();
      if (/^\d+$/.test(String(id))) q = q.eq('id', Number(id));
      else q = q.eq('sheet_row_id', String(id));
      const { error } = await q;
      if (error) throw error;
      return { success: true };
    },

    // 8. 카드매출
    getCardSales: async function(token, yearMonth) {
      const client = getSupabase();
      const { data } = await client.from('card_sales').select('amount').eq('year_month', yearMonth).maybeSingle();
      return { success: true, yearMonth: yearMonth, amount: (data && data.amount) ? Number(data.amount) : 0 };
    },

    saveCardSales: async function(token, yearMonth, amount) {
      const client = getSupabase();
      const sess = getSession_();
      const amt = Number(String(amount || 0).replace(/,/g, ''));
      const { error } = await client.from('card_sales').upsert({
        year_month: yearMonth,
        amount: amt,
        created_by: sess ? sess.name : '지사장'
      }, { onConflict: 'year_month' });
      if (error) throw error;
      return { success: true, yearMonth: yearMonth, amount: amt };
    },

    // 9. 사용자 관리
    getUserNames: async function(token) {
      const client = getSupabase();
      const { data, error } = await client.from('app_users').select('name, job');
      if (error) return { success: true, names: ['최영국', '이수열', '박광춘', '정문재', '임영민'] };
      const eligible = ['컨설턴트(영업)', '엔지니어(기술)', '서비스(CS)'];
      const names = (data || []).filter(u => eligible.includes(u.job)).map(u => u.name);
      return { success: true, names: names.length ? names : ['최영국', '이수열', '박광춘', '정문재', '임영민'] };
    },

    adminListUsers: async function(token) {
      const client = getSupabase();
      const { data, error } = await client.from('app_users').select('*').order('created_at', { ascending: true });
      if (error) throw error;
      const users = (data || []).map(u => ({
        이름: u.name,
        전화번호: u.phone,
        등록일시: u.created_at ? u.created_at.slice(0, 16).replace('T', ' ') : '',
        최근접속일시: u.last_login_at ? u.last_login_at.slice(0, 16).replace('T', ' ') : '',
        권한: u.role || '읽기전용',
        직무: u.job || '',
        브라우저: u.browser || '-',
        기기유형: u.device_type || '-',
        세션유지중: true,
        접속중: true
      }));
      return { success: true, users: users };
    },

    adminUpdateUser: async function(token, phone, updates) {
      const client = getSupabase();
      const patch = {};
      if (updates.이름) patch.name = updates.이름;
      if (updates.권한) patch.role = updates.권한;
      if (updates.직무) patch.job = updates.직무;
      const { error } = await client.from('app_users').update(patch).eq('phone', phone);
      if (error) throw error;
      return { success: true };
    },

    adminDeleteUser: async function(token, phone) {
      const client = getSupabase();
      const { error } = await client.from('app_users').delete().eq('phone', phone);
      if (error) throw error;
      return { success: true };
    },

    adminListLoginHistory: async function(token, from, to) {
      const client = getSupabase();
      let q = client.from('login_logs').select('*').order('created_at', { ascending: false });
      if (from) q = q.gte('created_at', from + 'T00:00:00');
      if (to) q = q.lte('created_at', to + 'T23:59:59');
      const { data, error } = await q;
      if (error) return { success: true, rows: [] };
      const rows = (data || []).map(r => [
        r.name,
        r.phone,
        r.created_at ? r.created_at.slice(0, 19).replace('T', ' ') : '',
        r.action || '로그인'
      ]);
      return { success: true, rows: rows };
    },

    adminListHistory: async function(token, from, to) {
      const client = getSupabase();
      let q = client.from('activity_logs').select('*').order('created_at', { ascending: false });
      if (from) q = q.gte('created_at', from + 'T00:00:00');
      if (to) q = q.lte('created_at', to + 'T23:59:59');
      const { data, error } = await q;
      if (error) return { success: true, rows: [] };
      const rows = (data || []).map(r => [
        r.created_at ? r.created_at.slice(0, 19).replace('T', ' ') : '',
        r.consultant || '',
        r.lead_id || '',
        r.action || '',
        '',
        '',
        JSON.stringify(r.changes || '')
      ]);
      return { success: true, rows: rows };
    },

    // 10. 목표/계획
    getSalesTargetByProduct: async function(token, yearMonth) {
      const client = getSupabase();
      const PRODUCTS = ['알람', '블루스캔', '휴엔', '정보보안'];
      const { data } = await client.from('sales_targets_product').select('*').eq('year_month', yearMonth);
      const map = {};
      PRODUCTS.forEach(p => {
        map[p] = { 상품종류: p, 목표_수주금액: 0, 목표_개시금액: 0, 목표_유지감소: 0, 계획_수주금액: 0, 계획_개시금액: 0, 계획_유지감소: 0 };
      });
      (data || []).forEach(r => {
        if (map[r.product_type]) {
          map[r.product_type] = {
            상품종류: r.product_type,
            목표_수주금액: Number(r.target_order) || 0,
            목표_개시금액: Number(r.target_start) || 0,
            목표_유지감소: Number(r.target_cancel) || 0,
            계획_수주금액: Number(r.plan_order) || 0,
            계획_개시금액: Number(r.plan_start) || 0,
            계획_유지감소: Number(r.plan_cancel) || 0
          };
        }
      });
      return { success: true, yearMonth: yearMonth, products: PRODUCTS, items: PRODUCTS.map(p => map[p]) };
    },

    saveSalesTargetByProduct: async function(token, yearMonth, items) {
      const client = getSupabase();
      const rows = (items || []).map(it => ({
        year_month: yearMonth,
        product_type: it.상품종류,
        target_order: Number(it.목표_수주금액) || 0,
        target_start: Number(it.목표_개시금액) || 0,
        target_cancel: Number(it.목표_유지감소) || 0,
        plan_order: Number(it.계획_수주금액) || 0,
        plan_start: Number(it.계획_개시금액) || 0,
        plan_cancel: Number(it.계획_유지감소) || 0,
        updated_at: new Date().toISOString()
      }));
      const { error } = await client.from('sales_targets_product').upsert(rows, { onConflict: 'year_month,product_type' });
      if (error) throw error;
      return { success: true };
    },

    getSalesTargetByRep: async function(token, yearMonth) {
      const client = getSupabase();
      const { data } = await client.from('sales_targets_rep').select('*').eq('year_month', yearMonth);
      const items = {};
      (data || []).forEach(r => {
        if (!items[r.rep_name]) items[r.rep_name] = {};
        items[r.rep_name][r.product_type] = {
          목표_수주금액: Number(r.target_order) || 0,
          목표_개시금액: Number(r.target_start) || 0,
          목표_유지감소: Number(r.target_cancel) || 0
        };
      });
      return { success: true, yearMonth: yearMonth, items: items };
    },

    saveSalesTargetByRepBulk: async function(token, yearMonth, items) {
      const client = getSupabase();
      const rows = (items || []).map(it => ({
        year_month: yearMonth,
        rep_name: it.영업담당,
        product_type: it.상품종류,
        target_order: Number(it.목표_수주금액) || 0,
        target_start: Number(it.목표_개시금액) || 0,
        target_cancel: Number(it.목표_유지감소) || 0,
        updated_at: new Date().toISOString()
      }));
      const { error } = await client.from('sales_targets_rep').upsert(rows, { onConflict: 'year_month,rep_name,product_type' });
      if (error) throw error;
      return { success: true };
    },

    getSalesTargetSafety: async function(token, yearMonth) {
      const client = getSupabase();
      const { data } = await client.from('sales_targets_safety').select('*').eq('year_month', yearMonth).maybeSingle();
      const item = {
        목표_수주: data ? Number(data.target_order) || 0 : 0,
        목표_매출: data ? Number(data.target_sales) || 0 : 0,
        계획_수주: data ? Number(data.plan_order) || 0 : 0,
        계획_매출: data ? Number(data.plan_sales) || 0 : 0
      };
      return { success: true, yearMonth: yearMonth, item: item };
    },

    saveSalesTargetSafety: async function(token, yearMonth, data) {
      const client = getSupabase();
      const { error } = await client.from('sales_targets_safety').upsert({
        year_month: yearMonth,
        target_order: Number(data.목표_수주) || 0,
        target_sales: Number(data.목표_매출) || 0,
        plan_order: Number(data.계획_수주) || 0,
        plan_sales: Number(data.계획_매출) || 0,
        updated_at: new Date().toISOString()
      }, { onConflict: 'year_month' });
      if (error) throw error;
      return { success: true };
    },

    getSafetyProductSummary: async function(token, yearMonth) {
      const targetRes = await Backend.getSalesTargetSafety(token, yearMonth);
      const cardRes = await Backend.getCardSales(token, yearMonth);
      const client = getSupabase();
      const ym = yearMonth.slice(0, 7);
      const y = ym.slice(2, 4);
      const m = ym.slice(5, 7);
      const forecastStr = `${y}.${m}월`;

      const { data: prodData } = await client.from('daily_product_reports').select('*');
      let actOrder = 0, actSales = 0;
      (prodData || []).forEach(r => {
        if (r.category !== '지사' && r.category !== '법인') return;
        const rDate = r.report_date || '';
        const amt = Number(r.total_amount) || 0;
        if (rDate.slice(0, 7) === ym) actOrder += amt;
        if (r.sales_forecast === forecastStr && r.sales_status === '매출') actSales += amt;
      });
      actSales += (cardRes.amount || 0);

      return {
        success: true,
        yearMonth: ym,
        목표: { 수주: targetRes.item.목표_수주, 매출: targetRes.item.목표_매출 },
        계획: { 수주: targetRes.item.계획_수주, 매출: targetRes.item.계획_매출 },
        실적: { 수주: Math.round(actOrder / 1000), 매출: Math.round(actSales / 1000) },
        카드매출: cardRes.amount || 0
      };
    },

    // 11. 일일실적보고 (자동계산)
    getDailyReportAuto: async function(token, dateStr) {
      const ds = dateStr || getTzToday();
      const ym = ds.slice(0, 7);
      const day = Number(ds.slice(8, 10));
      const targetRes = await Backend.getSalesTargetByProduct(token, ym);
      const targetMap = {};
      (targetRes.items || []).forEach(it => { targetMap[it.상품종류] = it; });

      const client = getSupabase();
      const [ordRes, canRes, prcRes, rstRes] = await Promise.all([
        client.from('daily_orders').select('*'),
        client.from('daily_cancels').select('*'),
        client.from('daily_price_changes').select('*'),
        client.from('daily_restarts').select('*')
      ]);

      const PRODUCTS = ['알람', '정보보안', '휴엔', '블루스캔'];
      const PROD_FILTERS = { '알람': ['알람', '유지보수', '블루스캔'], '정보보안': ['정보보안'], '휴엔': ['휴엔'], '블루스캔': ['블루스캔'] };

      const items = PRODUCTS.map(p => {
        const allowed = PROD_FILTERS[p] || [p];
        let ordToday = 0, ordCum = 0, startToday = 0, startCum = 0;
        let canToday = 0, canCum = 0, incToday = 0, incCum = 0, decToday = 0, decCum = 0, rstToday = 0, rstCum = 0;

        (ordRes.data || []).forEach(r => {
          if (r.gross_type === '법인' || !allowed.includes(r.product_name)) return;
          const fee = Number(r.monthly_fee) || 0;
          if (r.contract_date && r.contract_date.slice(0, 7) === ym) {
            const d = Number(r.contract_date.slice(8, 10));
            if (d <= day) ordCum += fee;
            if (d === day) ordToday += fee;
          }
          if (r.billing_date && r.billing_date.slice(0, 7) === ym) {
            const d = Number(r.billing_date.slice(8, 10));
            if (d <= day) startCum += fee;
            if (d === day) startToday += fee;
          }
        });

        (canRes.data || []).forEach(r => {
          if (r.gross_type === '법인' || !allowed.includes(r.product_name)) return;
          const fee = Number(r.monthly_fee) || 0;
          if (r.confirm_date && r.confirm_date.slice(0, 7) === ym) {
            const d = Number(r.confirm_date.slice(8, 10));
            if (d <= day) canCum += fee;
            if (d === day) canToday += fee;
          }
        });

        (prcRes.data || []).forEach(r => {
          if (r.gross_type === '법인' || !allowed.includes(r.product_name)) return;
          const amt = Number(r.diff_amount) || 0;
          if (r.billing_date && r.billing_date.slice(0, 7) === ym) {
            const d = Number(r.billing_date.slice(8, 10));
            if (d <= day) { if (amt >= 0) incCum += amt; else decCum += Math.abs(amt); }
            if (d === day) { if (amt >= 0) incToday += amt; else decToday += Math.abs(amt); }
          }
        });

        (rstRes.data || []).forEach(r => {
          if (r.gross_type === '법인' || !allowed.includes(r.product_name)) return;
          const fee = Number(r.monthly_fee) || 0;
          if (r.restart_date && r.restart_date.slice(0, 7) === ym) {
            const d = Number(r.restart_date.slice(8, 10));
            if (d <= day) rstCum += fee;
            if (d === day) rstToday += fee;
          }
        });

        const dayNet = startToday - (canToday - incToday - decToday - rstToday);
        const cumNet = startCum - (canCum - incCum - decCum - rstCum);
        const t = targetMap[p] || {};

        return {
          상품: p,
          수주_전일누계: Math.round((ordCum - ordToday) / 1000),
          수주_당일: Math.round(ordToday / 1000),
          수주_누계: Math.round(ordCum / 1000),
          목표_수주: t.목표_수주금액 || 0,
          개시_전일누계: Math.round((startCum - startToday) / 1000),
          개시_당일: Math.round(startToday / 1000),
          개시_누계: Math.round(startCum / 1000),
          목표_개시: t.목표_개시금액 || 0,
          유지증가_전일누계: Math.round((cumNet - dayNet) / 1000),
          유지증가_당일: Math.round(dayNet / 1000),
          유지증가_누계: Math.round(cumNet / 1000),
          목표_유지증가: (t.목표_개시금액 || 0) - (t.목표_유지감소 || 0)
        };
      });

      return { success: true, date: ds, products: PRODUCTS, items: items };
    },

    getExtraProductReport: async function(token, dateStr) {
      const client = getSupabase();
      const ds = dateStr || getTzToday();
      const { data } = await client.from('daily_extra_products').select('*').eq('report_date', ds).maybeSingle();
      return {
        success: true, date: ds,
        안전상품: {
          수주: { 목표: data ? data.safety_order_target : 0, 전일누계: data ? data.safety_order_prev : 0, 당일: data ? data.safety_order_today : 0 },
          매출: { 목표: data ? data.safety_sales_target : 0, 전일누계: data ? data.safety_sales_prev : 0, 당일: data ? data.safety_sales_today : 0 }
        },
        AI도어캠: {
          판매량: { 목표: data ? data.doorcam_target : 0, 전일누계: data ? data.doorcam_prev : 0, 당일: data ? data.doorcam_today : 0 }
        }
      };
    },

    saveExtraProductReport: async function(token, dateStr, d) {
      const client = getSupabase();
      const ds = dateStr || getTzToday();
      const record = {
        report_date: ds,
        safety_order_target: d.안전상품_수주_목표 || 0,
        safety_order_prev: d.안전상품_수주_전일누계 || 0,
        safety_order_today: d.안전상품_수주_당일 || 0,
        safety_sales_target: d.안전상품_매출_목표 || 0,
        safety_sales_prev: d.안전상품_매출_전일누계 || 0,
        safety_sales_today: d.안전상품_매출_당일 || 0,
        doorcam_target: d.AI도어캠_판매량_목표 || 0,
        doorcam_prev: d.AI도어캠_판매량_전일누계 || 0,
        doorcam_today: d.AI도어캠_판매량_당일 || 0,
        updated_at: new Date().toISOString()
      };
      const { error } = await client.from('daily_extra_products').upsert(record, { onConflict: 'report_date' });
      if (error) throw error;
      return Backend.getExtraProductReport(token, ds);
    },

    // 12. 영업현황 및 종합대시보드
    getSalesStatus: async function(token, yearMonth, productFilter) {
      const ym = yearMonth || getTzToday().slice(0, 7);
      const pf = productFilter || '일반알람';
      const client = getSupabase();

      // 1. 스냅샷 조회 (데이터가 있는 유효한 스냅샷만 반환)
      try {
        const { data: snap } = await client.from('sales_status_snapshots').select('payload_json').eq('year_month', ym).eq('product_filter', pf).maybeSingle();
        if (snap && snap.payload_json && snap.payload_json.actual && (snap.payload_json.actual.수주 || snap.payload_json.actual.개시 || snap.payload_json.actual.유지감소)) {
          return Object.assign({ success: true, yearMonth: ym, fromSnapshot: true }, snap.payload_json);
        }
      } catch(e) {}

      // 2. 실시간 라이브 계산
      const [ordRes, canRes, prcRes, rstRes, tgtProdRes, tgtRepRes] = await Promise.all([
        client.from('daily_orders').select('*'),
        client.from('daily_cancels').select('*'),
        client.from('daily_price_changes').select('*'),
        client.from('daily_restarts').select('*'),
        client.from('sales_targets_product').select('*').eq('year_month', ym),
        client.from('sales_targets_rep').select('*').eq('year_month', ym)
      ]);

      const SALES_STATUS_PRODUCT_FILTERS = {
        '일반알람': ['알람', '블루스캔', '유지보수'],
        '알람+휴엔': ['알람', '블루스캔', '유지보수', '휴엔'],
        '정보보안': ['정보보안'],
        '디지털': ['정보보안'],
        '휴엔': ['휴엔']
      };
      const SALES_TARGET_CATEGORIES = {
        '일반알람': ['알람'],
        '알람+휴엔': ['알람', '휴엔'],
        '정보보안': ['정보보안'],
        '디지털': ['정보보안'],
        '휴엔': ['휴엔']
      };

      const filterKey = SALES_STATUS_PRODUCT_FILTERS[pf] ? pf : '일반알람';
      const allowed = SALES_STATUS_PRODUCT_FILTERS[filterKey];
      const targetCats = SALES_TARGET_CATEGORIES[filterKey] || ['알람'];

      const parts = String(ym).split('-');
      const yy = Number(parts[0]), mm = Number(parts[1]);
      const daysInMonth = new Date(yy, mm, 0).getDate();

      const orders = ordRes.data || [];
      const cancels = canRes.data || [];
      const prices = prcRes.data || [];
      const restarts = rstRes.data || [];

      const 수주Raw = new Array(daysInMonth).fill(0);
      const 개시Raw = new Array(daysInMonth).fill(0);
      const 해약Raw = new Array(daysInMonth).fill(0);
      const pricePos = new Array(daysInMonth).fill(0);
      const priceNeg = new Array(daysInMonth).fill(0);
      const 재개시Raw = new Array(daysInMonth).fill(0);

      // Orders (수주: contract_date, 개시: billing_date)
      orders.forEach(r => {
        if (String(r.gross_type) === '법인') return;
        if (allowed.indexOf(String(r.product_name)) === -1) return;
        if (r.contract_date && String(r.contract_date).slice(0, 7) === ym) {
          const d = Number(String(r.contract_date).slice(8, 10));
          if (d >= 1 && d <= daysInMonth) 수주Raw[d - 1] += Number(r.monthly_fee) || 0;
        }
        if (r.billing_date && String(r.billing_date).slice(0, 7) === ym) {
          const d = Number(String(r.billing_date).slice(8, 10));
          if (d >= 1 && d <= daysInMonth) 개시Raw[d - 1] += Number(r.monthly_fee) || 0;
        }
      });

      // Cancels (해약: confirm_date)
      cancels.forEach(r => {
        if (String(r.gross_type) === '법인') return;
        if (allowed.indexOf(String(r.product_name)) === -1) return;
        if (r.confirm_date && String(r.confirm_date).slice(0, 7) === ym) {
          const d = Number(String(r.confirm_date).slice(8, 10));
          if (d >= 1 && d <= daysInMonth) 해약Raw[d - 1] += Number(r.monthly_fee) || 0;
        }
      });

      // Price changes (인상/인하: billing_date)
      prices.forEach(r => {
        if (String(r.gross_type) === '법인') return;
        if (allowed.indexOf(String(r.product_name)) === -1) return;
        if (r.billing_date && String(r.billing_date).slice(0, 7) === ym) {
          const d = Number(String(r.billing_date).slice(8, 10));
          if (d >= 1 && d <= daysInMonth) {
            const amt = Number(r.diff_amount) || 0;
            if (amt >= 0) pricePos[d - 1] += amt; else priceNeg[d - 1] += amt;
          }
        }
      });

      // Restarts (재개시: restart_date)
      restarts.forEach(r => {
        if (String(r.gross_type) === '법인') return;
        if (allowed.indexOf(String(r.product_name)) === -1) return;
        if (r.restart_date && String(r.restart_date).slice(0, 7) === ym) {
          const d = Number(String(r.restart_date).slice(8, 10));
          if (d >= 1 && d <= daysInMonth) 재개시Raw[d - 1] += Number(r.monthly_fee) || 0;
        }
      });

      // Target calculation
      let 목수 = 0, 목개 = 0, 목유감 = 0, 계수 = 0, 계개 = 0, 계유감 = 0;
      (tgtProdRes.data || []).filter(r => targetCats.indexOf(r.product_type) !== -1).forEach(r => {
        목수 += Number(r.target_order) || 0;
        목개 += Number(r.target_start) || 0;
        목유감 += Number(r.target_cancel) || 0;
        계수 += Number(r.plan_order) || 0;
        계개 += Number(r.plan_start) || 0;
        계유감 += Number(r.plan_cancel) || 0;
      });
      const 목표유지증가 = 목개 - 목유감;
      const 계획유지증가 = 계개 - 계유감;
      const target = {
        년월: ym,
        목표_수주금액: 목수, 목표_개시금액: 목개, 목표_유지감소: 목유감, 목표_유지증가: 목표유지증가,
        계획_수주금액: 계수, 계획_개시금액: 계개, 계획_유지감소: 계유감, 계획_유지증가: 계획유지증가,
        목표대비계획비율: 목표유지증가 !== 0 ? Math.round((계획유지증가 / 목표유지증가) * 1000) / 10 : 0
      };

      const rows = [];
      let 수주누계Raw = 0, 개시누계Raw = 0, 해약누계Raw = 0, 인상누계Raw = 0, 인하누계Raw = 0, 재개시누계Raw = 0, 유지증가누적Raw = 0;

      for (let d = 1; d <= daysInMonth; d++) {
        const i = d - 1;
        const 수주당일 = 수주Raw[i] || 0, 개시당일 = 개시Raw[i] || 0, 해약당일 = 해약Raw[i] || 0;
        const 인상당일 = pricePos[i] || 0, 인하당일 = priceNeg[i] || 0, 재개시당일 = 재개시Raw[i] || 0;
        const 일유증당일 = 개시당일 - (해약당일 - 인상당일 - 인하당일 - 재개시당일);

        수주누계Raw += 수주당일;
        개시누계Raw += 개시당일;
        해약누계Raw += 해약당일;
        인상누계Raw += 인상당일;
        인하누계Raw += 인하당일;
        재개시누계Raw += 재개시당일;
        유지증가누적Raw += 일유증당일;

        const 유지감소누계Raw = 해약누계Raw - 인상누계Raw - 인하누계Raw - 재개시누계Raw;
        const 유지증가누계Raw = 유지증가누적Raw;

        const 수주당일K = Math.round(수주당일 / 1000);
        const 개시당일K = Math.round(개시당일 / 1000);
        const 해약중지당일K = Math.round(해약당일 / 1000);
        const 인상당일K = Math.round(인상당일 / 1000);
        const 인하당일K = Math.round(인하당일 / 1000);
        const 재개시당일K = Math.round(재개시당일 / 1000);
        const 일유증당일K = Math.round(일유증당일 / 1000);
        const 유지증가누계K = Math.round(유지증가누계Raw / 1000);
        const 달성률 = 목표유지증가 !== 0 ? Math.round((유지증가누계K / 목표유지증가) * 1000) / 10 : 0;

        rows.push({
          날짜: ym + '-' + String(d).padStart(2, '0'),
          수주: 수주당일K, 개시: 개시당일K, 해약중지: 해약중지당일K,
          인상: 인상당일K, 인하: 인하당일K, 재개시: 재개시당일K,
          일유증: 일유증당일K, 유지증가: 유지증가누계K, 달성률: 달성률,
          누계수주: Math.round(수주누계Raw / 1000),
          누계개시: Math.round(개시누계Raw / 1000),
          누계해약중지: Math.round(해약누계Raw / 1000),
          누계인상: Math.round(인상누계Raw / 1000),
          누계인하: Math.round(인하누계Raw / 1000),
          누계재개시: Math.round(재개시누계Raw / 1000),
          누계유지감소: Math.round(유지감소누계Raw / 1000),
          누계유지증가: 유지증가누계K
        });
      }

      const last = rows[rows.length - 1] || {};
      const actual = {
        수주: last.누계수주 || 0,
        개시: last.누계개시 || 0,
        유지감소: last.누계유지감소 || 0,
        유지증가: last.누계유지증가 || 0
      };

      const reps = ['최영국', '이수열', '박광춘', '정문재', '임영민'];
      const repActualsRaw = {};
      reps.forEach(r => { repActualsRaw[r] = { 수주: 0, 개시: 0, 해약: 0, 인상: 0, 인하: 0, 재개시: 0 }; });

      orders.forEach(r => {
        if (String(r.gross_type) === '법인') return;
        if (allowed.indexOf(String(r.product_name)) === -1) return;
        const rep = String(r.rep_name || '').trim();
        if (!repActualsRaw[rep]) repActualsRaw[rep] = { 수주: 0, 개시: 0, 해약: 0, 인상: 0, 인하: 0, 재개시: 0 };
        if (r.contract_date && String(r.contract_date).slice(0, 7) === ym) repActualsRaw[rep].수주 += Number(r.monthly_fee) || 0;
        if (r.billing_date && String(r.billing_date).slice(0, 7) === ym) repActualsRaw[rep].개시 += Number(r.monthly_fee) || 0;
      });

      cancels.forEach(r => {
        if (String(r.gross_type) === '법인') return;
        if (allowed.indexOf(String(r.product_name)) === -1) return;
        const rep = String(r.rep_name || '').trim();
        if (!repActualsRaw[rep]) repActualsRaw[rep] = { 수주: 0, 개시: 0, 해약: 0, 인상: 0, 인하: 0, 재개시: 0 };
        if (r.confirm_date && String(r.confirm_date).slice(0, 7) === ym) repActualsRaw[rep].해약 += Number(r.monthly_fee) || 0;
      });

      prices.forEach(r => {
        if (String(r.gross_type) === '법인') return;
        if (allowed.indexOf(String(r.product_name)) === -1) return;
        const rep = String(r.rep_name || '').trim();
        if (!repActualsRaw[rep]) repActualsRaw[rep] = { 수주: 0, 개시: 0, 해약: 0, 인상: 0, 인하: 0, 재개시: 0 };
        if (r.billing_date && String(r.billing_date).slice(0, 7) === ym) {
          const amt = Number(r.diff_amount) || 0;
          if (amt >= 0) repActualsRaw[rep].인상 += amt; else repActualsRaw[rep].인하 += amt;
        }
      });

      restarts.forEach(r => {
        if (String(r.gross_type) === '법인') return;
        if (allowed.indexOf(String(r.product_name)) === -1) return;
        const rep = String(r.rep_name || '').trim();
        if (!repActualsRaw[rep]) repActualsRaw[rep] = { 수주: 0, 개시: 0, 해약: 0, 인상: 0, 인하: 0, 재개시: 0 };
        if (r.restart_date && String(r.restart_date).slice(0, 7) === ym) repActualsRaw[rep].재개시 += Number(r.monthly_fee) || 0;
      });

      const repMetrics = {};
      Object.keys(repActualsRaw).forEach(rep => {
        const d = repActualsRaw[rep];
        const 유지감소Raw = d.해약 - d.인상 - d.인하 - d.재개시;
        const 유지증가Raw = d.개시 - 유지감소Raw;
        repMetrics[rep] = {
          수주: Math.round(d.수주 / 1000),
          개시: Math.round(d.개시 / 1000),
          유지감소: Math.round(유지감소Raw / 1000),
          유지증가: Math.round(유지증가Raw / 1000)
        };
      });

      const repTargets = {};
      const repTargetRows = tgtRepRes.data || [];
      const hasRepTargets = repTargetRows.length > 0;
      reps.forEach(rep => {
        let rOrd = 0, rStart = 0, rCancel = 0;
        if (hasRepTargets) {
          repTargetRows.filter(r => r.rep_name === rep && targetCats.indexOf(r.product_type) !== -1).forEach(r => {
            rOrd += Number(r.target_order) || 0;
            rStart += Number(r.target_start) || 0;
            rCancel += Number(r.target_cancel) || 0;
          });
        } else {
          rOrd = Math.round(target.목표_수주금액 / reps.length);
          rStart = Math.round(target.목표_개시금액 / reps.length);
          rCancel = Math.round(target.목표_유지감소 / reps.length);
        }
        repTargets[rep] = {
          목표_수주금액: rOrd,
          목표_개시금액: rStart,
          목표_유지감소: rCancel,
          목표_유지증가: rStart - rCancel
        };
      });

      const result = {
        success: true,
        yearMonth: ym,
        target: target,
        actual: actual,
        rows: rows,
        repMetrics: repMetrics,
        repTargets: repTargets
      };

      // 스냅샷 저장 시도 (비동기)
      try {
        client.from('sales_status_snapshots').upsert({
          year_month: ym,
          product_filter: pf,
          payload_json: result,
          saved_at: new Date().toISOString()
        }, { onConflict: 'year_month,product_filter' }).then(() => {});
      } catch(e) {}

      return result;
    },

    simulateSalesStatus: async function(token, yearMonth, productFilter, overrides) {
      const res = await Backend.getSalesStatus(token, yearMonth, productFilter);
      return Object.assign({}, res, { simulated: true });
    },

    refreshSalesStatusSnapshot: async function(token, yearMonth, productFilter) {
      const ym = yearMonth || getTzToday().slice(0, 7);
      const pf = productFilter || '일반알람';
      const client = getSupabase();
      try {
        await client.from('sales_status_snapshots').delete().eq('year_month', ym).eq('product_filter', pf);
      } catch(e) {}
      return Backend.getSalesStatus(token, ym, pf);
    },

    refreshSalesStatusSnapshotsForMonths: async function(token, months) {
      return { success: true };
    },

    getDashboardBundle: async function(token, yearMonth, category) {
      const ym = yearMonth || getTzToday().slice(0, 7);
      const cat = category || '일반알람';
      const statusRes = await Backend.getSalesStatus(token, ym, cat);

      const HOLIDAYS = new Set([
        '2026-01-01','2026-02-16','2026-02-17','2026-02-18','2026-03-01','2026-03-02',
        '2026-05-05','2026-05-08','2026-06-06','2026-08-15','2026-08-17',
        '2026-09-24','2026-09-25','2026-09-26','2026-09-27','2026-10-03','2026-10-05','2026-10-09','2026-12-25',
        '2027-01-01','2027-02-06','2027-02-07','2027-02-08','2027-02-09','2027-03-01',
        '2027-05-05','2027-05-13','2027-06-06','2027-08-15','2027-08-16',
        '2027-09-14','2027-09-15','2027-09-16','2027-10-03','2027-10-04','2027-10-09','2027-10-11','2027-12-25','2027-12-27'
      ]);

      const parts = String(ym).split('-');
      const yy = Number(parts[0]), mm = Number(parts[1]);
      const daysInMonth = new Date(yy, mm, 0).getDate();
      const dNow = new Date();
      const todayYm = `${dNow.getFullYear()}-${String(dNow.getMonth() + 1).padStart(2, '0')}`;
      const todayDate = dNow.getDate();

      let totalWorking = 0, elapsedWorking = 0;
      for (let d = 1; d <= daysInMonth; d++) {
        const dateObj = new Date(yy, mm - 1, d);
        const dow = dateObj.getDay();
        const ds = `${yy}-${String(mm).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        const isWorking = dow !== 0 && dow !== 6 && !HOLIDAYS.has(ds);
        if (isWorking) {
          totalWorking++;
          if (ym < todayYm || (ym === todayYm && d <= todayDate)) elapsedWorking++;
        }
      }
      if (ym > todayYm) elapsedWorking = 0;
      const working = {
        totalWorkingDays: totalWorking,
        elapsedWorkingDays: elapsedWorking,
        ratio: totalWorking ? Math.round((elapsedWorking / totalWorking) * 1000) / 10 : 0
      };

      const client = getSupabase();
      const [ordRes, canRes, prcRes] = await Promise.all([
        client.from('daily_orders').select('*'),
        client.from('daily_cancels').select('*'),
        client.from('daily_price_changes').select('*')
      ]);

      const today = getTzToday();
      const allowed = ['알람', '블루스캔', '유지보수'];

      function aggregateComp(rows, keyFn, amtFn) {
        const map = {};
        let totalAmt = 0, totalCnt = 0;
        rows.forEach(r => {
          const k = keyFn(r) || '기타';
          const a = amtFn ? (Number(amtFn(r)) || 0) : 0;
          if (!map[k]) map[k] = { name: k, count: 0, amount: 0 };
          map[k].count++; map[k].amount += a;
          totalCnt++; totalAmt += a;
        });
        const list = Object.keys(map).map(k => map[k]);
        list.forEach(it => {
          it.pctCount = totalCnt ? Math.round((it.count / totalCnt) * 100) : 0;
          it.pctAmount = totalAmt ? Math.round((it.amount / totalAmt) * 100) : 0;
        });
        list.sort((a, b) => b.amount - a.amount || b.count - a.count);
        return { list: list, totalCount: totalCnt, totalAmount: totalAmt };
      }

      function daysBetween(a, b) {
        if (!a || !b || !/^\d{4}-\d{2}-\d{2}/.test(String(a)) || !/^\d{4}-\d{2}-\d{2}/.test(String(b))) return null;
        const da = new Date(String(a).slice(0, 10)), db = new Date(String(b).slice(0, 10));
        return Math.round((db - da) / 86400000);
      }

      function gapBucket(days) {
        if (days === null || days === undefined || isNaN(days)) return '미정';
        if (days <= 3) return '0~3일';
        if (days <= 7) return '4~7일';
        if (days <= 14) return '8~14일';
        if (days <= 30) return '15~30일';
        return '31일 이상';
      }

      function bucketize(daysArr) {
        const buckets = {};
        daysArr.forEach(d => { const b = gapBucket(d); buckets[b] = (buckets[b] || 0) + 1; });
        const order = ['0~3일', '4~7일', '8~14일', '15~30일', '31일 이상', '미정'];
        const total = daysArr.length;
        return order.filter(b => buckets[b]).map(b => ({ label: b, count: buckets[b], pct: total ? Math.round((buckets[b] / total) * 100) : 0 }));
      }

      function avgOf(arr) { return arr.length ? Math.round((arr.reduce((a, b) => a + b, 0) / arr.length) * 10) / 10 : 0; }

      // Order analytics
      const filteredOrders = (ordRes.data || [])
        .filter(r => (r.contract_date && r.contract_date.slice(0, 7) === ym && r.contract_date <= today) || (r.billing_date && r.billing_date.slice(0, 7) === ym && r.billing_date <= today))
        .filter(r => allowed.indexOf(String(r.product_name)) !== -1)
        .filter(r => String(r.gross_type) !== '법인');

      function buildOrderFor(list) {
        const motive = aggregateComp(list, r => r.sales_motive || '기타', r => Number(r.monthly_fee) || 0);
        const product = aggregateComp(list, r => r.product_name || '기타', r => Number(r.monthly_fee) || 0);
        const amounts = list.map(r => Number(r.monthly_fee) || 0);
        const total = amounts.reduce((a, b) => a + b, 0);
        const avg = amounts.length ? Math.round(total / amounts.length) : 0;
        const gapStart = list.map(r => daysBetween(r.contract_date, r.start_date)).filter(v => v !== null);
        const gapBase = list.map(r => daysBetween(r.contract_date, r.billing_date)).filter(v => v !== null);
        const orderedThisMonth = list.filter(r => r.contract_date && r.contract_date.slice(0, 7) === ym);
        const startedSameMonth = orderedThisMonth.filter(r => r.billing_date && r.billing_date.slice(0, 7) === ym && r.billing_date <= today);
        const monthlyStartRate = orderedThisMonth.length ? Math.round((startedSameMonth.length / orderedThisMonth.length) * 100) : 0;
        return {
          count: list.length, amount: total, avgAmount: avg,
          byMotive: motive.list, byProduct: product.list,
          gapStart: { avg: avgOf(gapStart), buckets: bucketize(gapStart) },
          gapBase: { avg: avgOf(gapBase), buckets: bucketize(gapBase) },
          monthlyOrderCount: orderedThisMonth.length, monthlyStartedCount: startedSameMonth.length, monthlyStartRate: monthlyStartRate
        };
      }

      const orderOverall = buildOrderFor(filteredOrders);
      const reps = ['최영국', '이수열', '박광춘', '정문재', '임영민'];
      const orderByRep = {};
      reps.forEach(rep => { orderByRep[rep] = buildOrderFor(filteredOrders.filter(r => String(r.rep_name) === rep)); });

      // Cancel analytics
      const filteredCancels = (canRes.data || [])
        .filter(r => r.confirm_date && r.confirm_date.slice(0, 7) === ym && r.confirm_date <= today)
        .filter(r => allowed.indexOf(String(r.product_name)) !== -1)
        .filter(r => String(r.gross_type) !== '법인');

      function buildCancelFor(list) {
        const reason = aggregateComp(list, r => r.cancel_type || '기타', r => Number(r.monthly_fee) || 0);
        const product = aggregateComp(list, r => r.product_name || '기타', r => Number(r.monthly_fee) || 0);
        const amounts = list.map(r => Number(r.monthly_fee) || 0);
        const total = amounts.reduce((a, b) => a + b, 0);
        const avg = amounts.length ? Math.round(total / amounts.length) : 0;
        return { count: list.length, amount: total, avgAmount: avg, byReason: reason.list, byProduct: product.list };
      }
      const cancelOverall = buildCancelFor(filteredCancels);
      const cancelByRep = {};
      reps.forEach(rep => { cancelByRep[rep] = buildCancelFor(filteredCancels.filter(r => String(r.rep_name) === rep)); });

      // Price analytics
      function buildPriceFor(changeType) {
        const filtered = (prcRes.data || [])
          .filter(r => r.billing_date && r.billing_date.slice(0, 7) === ym && r.billing_date <= today)
          .filter(r => changeType === '인상' ? (Number(r.diff_amount) > 0) : (Number(r.diff_amount) < 0))
          .filter(r => String(r.gross_type) !== '법인');
        const amounts = filtered.map(r => Math.abs(Number(r.diff_amount) || 0));
        const total = amounts.reduce((a, b) => a + b, 0);
        const avg = amounts.length ? Math.round(total / amounts.length) : 0;
        const reason = aggregateComp(filtered, r => r.reason || '기타', r => Math.abs(Number(r.diff_amount) || 0));
        const product = aggregateComp(filtered, r => r.product_name || '기타', r => Math.abs(Number(r.diff_amount) || 0));
        const byRep = aggregateComp(filtered, r => r.rep_name || '기타', r => Math.abs(Number(r.diff_amount) || 0));
        const byReceiver = aggregateComp(filtered, r => r.receiver_name || '기타', r => Math.abs(Number(r.diff_amount) || 0));
        return { overall: { count: filtered.length, amount: total, avgAmount: avg }, byRep: byRep.list, byReceiver: byReceiver.list, byReason: reason.list, byProduct: product.list };
      }

      const priceUpPayload = buildPriceFor('인상');
      const priceDownPayload = buildPriceFor('인하');

      return {
        success: true,
        status: statusRes,
        working: { success: true, info: working },
        order: { success: true, yearMonth: ym, overall: orderOverall, byRep: orderByRep },
        cancel: { success: true, yearMonth: ym, overall: cancelOverall, byRep: cancelByRep },
        priceUp: Object.assign({ success: true, yearMonth: ym }, priceUpPayload),
        priceDown: Object.assign({ success: true, yearMonth: ym }, priceDownPayload)
      };
    },

    // 13. 설정 및 기타
    getEditableLists: async function(token) {
      const lists = { '영업동기': [], '해약유형': [], '인상인하사유': [], '영업컨설턴트': [], '상품일보_담당자': [] };
      const defaults = {};

      // 1. Try local storage first
      try {
        const local = localStorage.getItem('S1_EDITABLE_SETTINGS');
        if (local) {
          const parsed = JSON.parse(local);
          if (parsed && parsed.lists) {
            return { success: true, lists: parsed.lists, defaults: parsed.defaults || {} };
          }
        }
      } catch(e) {}

      // 2. Try Supabase
      try {
        const client = getSupabase();
        if (client) {
          const { data, error } = await client.from('editable_settings').select('*').order('sort_order', { ascending: true });
          if (!error && data) {
            data.forEach(r => {
              if (lists[r.category]) {
                lists[r.category].push(r.item_value);
                if (r.is_default) defaults[r.category] = r.item_value;
              }
            });
          }
        }
      } catch(e) {}

      // 기본값 폴백
      if (!lists['영업동기'].length) lists['영업동기'] = ['개척', '콜센터', '사내소개', '고객소개', '대리점', '관내이전', '관외이전', '그로스', '기타'];
      if (!lists['해약유형'].length) lists['해약유형'] = ['폐업', '타사전환', '관외이전', '관내이전', '통합', '공사', '경비절감', '고객사망', '중지'];
      if (!lists['인상인하사유'].length) lists['인상인하사유'] = ['변추가인상', '순수인상', '서비스추가', '경비구역축소', '약정기간', '해약방어인하', '법인인하'];
      if (!lists['영업컨설턴트'].length) lists['영업컨설턴트'] = ['최영국', '이수열', '박광춘', '정문재', '임영민'];
      if (!lists['상품일보_담당자'].length) lists['상품일보_담당자'] = ['박정훈', '박광모', '김상훈', '최영국', '이수열', '박광춘', '정문재', '임영민'];

      return { success: true, lists: lists, defaults: defaults };
    },

    saveEditableListsBulk: async function(token, payload) {
      const lists = {};
      const defaults = {};

      Object.keys(payload || {}).forEach(cat => {
        const entry = payload[cat] || {};
        lists[cat] = entry.items || [];
        if (entry.defaultValue) defaults[cat] = entry.defaultValue;
      });

      // 1. Save to localStorage immediately
      try {
        localStorage.setItem('S1_EDITABLE_SETTINGS', JSON.stringify({ lists: lists, defaults: defaults }));
      } catch(e) {}

      // 2. Try Supabase upsert safely
      try {
        const client = getSupabase();
        if (client) {
          const rows = [];
          Object.keys(payload || {}).forEach(cat => {
            const entry = payload[cat] || {};
            (entry.items || []).forEach((val, idx) => {
              rows.push({
                category: cat,
                item_value: val,
                is_default: (val === entry.defaultValue),
                sort_order: idx + 1
              });
            });
          });
          if (rows.length) {
            const { error } = await client.from('editable_settings').upsert(rows, { onConflict: 'category,item_value' });
            if (error) console.warn('Supabase editable_settings sync notice (saved locally):', error.message || error);
          }
        }
      } catch(e) {
        console.warn('Supabase sync skipped, saved locally:', e);
      }

      return { success: true, lists: lists, defaults: defaults };
    },

    getTaPortalUrl: async function(token) {
      const client = getSupabase();
      const { data } = await client.from('system_settings').select('setting_value').eq('setting_key', 'TA_PORTAL_URL').maybeSingle();
      return { success: true, url: data ? data.setting_value : 'https://script.google.com/macros/s/AKfycbzQVU3_smTlMsGqUoXB47p7oVP-6VPTZgskAzU0YiPu-VSYTkVE-a-YX8BxX1ce76UExA/exec' };
    },

    saveTaPortalUrl: async function(token, url) {
      const client = getSupabase();
      await client.from('system_settings').upsert({ setting_key: 'TA_PORTAL_URL', setting_value: url });
      return { success: true };
    },

    // 14. 접수함 큐
    submitAiReportMessage: async function(token, text) {
      const client = getSupabase();
      const sess = getSession_();
      const { error } = await client.from('inbox_ai_reports').insert([{
        submitted_by: sess ? sess.name : '사용자',
        raw_text: text,
        status: '대기'
      }]);
      if (error) throw error;
      return { success: true };
    },

    listPendingAiReportMessages: async function(token) {
      const client = getSupabase();
      const { data, error } = await client.from('inbox_ai_reports').select('*').eq('status', '대기').order('submitted_at', { ascending: false });
      if (error) return { success: true, items: [] };
      const items = (data || []).map(r => ({
        id: r.id,
        submittedAt: r.submitted_at ? r.submitted_at.slice(0, 16).replace('T', ' ') : '',
        submittedBy: r.submitted_by,
        text: r.raw_text,
        source: r.source || '수동'
      }));
      return { success: true, items: items };
    },

    markAiReportMessageProcessed: async function(token, id, resultType) {
      const client = getSupabase();
      const sess = getSession_();
      await client.from('inbox_ai_reports').update({
        status: '처리완료',
        processed_at: new Date().toISOString(),
        processed_by: sess ? sess.name : '마스터',
        registered_type: resultType
      }).eq('id', id);
      return { success: true };
    },

    dismissAiReportMessage: async function(token, id) {
      const client = getSupabase();
      const sess = getSession_();
      await client.from('inbox_ai_reports').update({
        status: '무시됨',
        processed_at: new Date().toISOString(),
        processed_by: sess ? sess.name : '마스터'
      }).eq('id', id);
      return { success: true };
    },

    submitGaJungjiMessage: async function(token, text) {
      const client = getSupabase();
      const sess = getSession_();
      const { error } = await client.from('inbox_gajungji').insert([{
        submitted_by: sess ? sess.name : 'CS근무자',
        raw_text: text,
        status: '대기'
      }]);
      if (error) throw error;
      return { success: true };
    },

    listPendingGaJungjiMessages: async function(token) {
      const client = getSupabase();
      const { data, error } = await client.from('inbox_gajungji').select('*').eq('status', '대기').order('submitted_at', { ascending: false });
      if (error) return { success: true, items: [] };
      const items = (data || []).map(r => ({
        id: r.id,
        submittedAt: r.submitted_at ? r.submitted_at.slice(0, 16).replace('T', ' ') : '',
        submittedBy: r.submitted_by,
        text: r.raw_text
      }));
      return { success: true, items: items };
    },

    markGaJungjiMessageProcessed: async function(token, id, resultType) {
      const client = getSupabase();
      const sess = getSession_();
      await client.from('inbox_gajungji').update({
        status: '처리완료',
        processed_at: new Date().toISOString(),
        processed_by: sess ? sess.name : '마스터',
        registered_type: resultType
      }).eq('id', id);
      return { success: true };
    },

    dismissGaJungjiMessage: async function(token, id) {
      const client = getSupabase();
      const sess = getSession_();
      await client.from('inbox_gajungji').update({
        status: '무시됨',
        processed_at: new Date().toISOString(),
        processed_by: sess ? sess.name : '마스터'
      }).eq('id', id);
      return { success: true };
    },

    // 15. 사업팀 데이터
    getLatestBizTeamData: async function(token, productType) {
      const client = getSupabase();
      const pt = productType || '일반알람';
      const { data } = await client.from('biz_team_data').select('*').eq('product_type', pt).order('report_date', { ascending: false }).limit(1).maybeSingle();
      if (!data) return { success: true, found: false };
      let branches = data.branches_json || [];
      if (typeof branches === 'string') {
        try { branches = JSON.parse(branches); } catch(e){ branches = []; }
      }
      let rows = data.rows_json || [];
      if (typeof rows === 'string') {
        try { rows = JSON.parse(rows); } catch(e){ rows = []; }
      }
      return {
        success: true, found: true,
        date: data.report_date,
        productType: data.product_type,
        branches: branches,
        rows: rows,
        registeredAt: data.created_at ? data.created_at.slice(0, 16).replace('T', ' ') : '',
        registeredBy: data.registered_by || ''
      };
    },

    getBizTeamDataNearestOnOrBefore: async function(token, dateStr, productType) {
      const client = getSupabase();
      const pt = productType || '일반알람';
      const { data } = await client.from('biz_team_data').select('*').eq('product_type', pt).lte('report_date', dateStr).order('report_date', { ascending: false }).limit(1).maybeSingle();
      if (!data) return { success: true, found: false };
      let branches = data.branches_json || [];
      if (typeof branches === 'string') {
        try { branches = JSON.parse(branches); } catch(e){ branches = []; }
      }
      let rows = data.rows_json || [];
      if (typeof rows === 'string') {
        try { rows = JSON.parse(rows); } catch(e){ rows = []; }
      }
      return {
        success: true, found: true,
        date: data.report_date,
        productType: data.product_type,
        branches: branches,
        rows: rows,
        registeredAt: data.created_at ? data.created_at.slice(0, 16).replace('T', ' ') : '',
        registeredBy: data.registered_by || ''
      };
    },

    getBizTeamDailyData: async function(token, dateStr, productType) {
      const client = getSupabase();
      const pt = productType || '일반알람';
      const { data } = await client.from('biz_team_data').select('*').eq('report_date', dateStr).eq('product_type', pt).maybeSingle();
      if (!data) return { success: true, found: false };
      let branches = data.branches_json || [];
      if (typeof branches === 'string') {
        try { branches = JSON.parse(branches); } catch(e){ branches = []; }
      }
      let rows = data.rows_json || [];
      if (typeof rows === 'string') {
        try { rows = JSON.parse(rows); } catch(e){ rows = []; }
      }
      return {
        success: true, found: true,
        branches: branches,
        rows: rows,
        rawText: data.raw_text || '',
        registeredAt: data.created_at ? data.created_at.slice(0, 16).replace('T', ' ') : '',
        registeredBy: data.registered_by || '',
        productType: data.product_type
      };
    },

    saveBizTeamDailyData: async function(token, dateStr, branchesJson, rowsJson, rawText, productType) {
      const client = getSupabase();
      const sess = getSession_();
      const pt = productType || '일반알람';
      let bJson = branchesJson;
      if (typeof branchesJson === 'string') {
        try { bJson = JSON.parse(branchesJson); } catch(e){ bJson = []; }
      }
      let rJson = rowsJson;
      if (typeof rowsJson === 'string') {
        try { rJson = JSON.parse(rowsJson); } catch(e){ rJson = []; }
      }

      const record = {
        report_date: dateStr,
        product_type: pt,
        registered_by: sess ? sess.name : '지사장',
        branches_json: bJson,
        rows_json: rJson,
        raw_text: rawText || '',
        created_at: new Date().toISOString()
      };
      const { error } = await client.from('biz_team_data').upsert(record, { onConflict: 'report_date,product_type' });
      if (error) throw error;
      return { success: true };
    },

    // 16. 세션 및 일반
    pingSession: async function(token) { return { success: true }; },
    extendSession: async function(token) { return { success: true }; },
    getWebAppUrl: async function() { return window.location.href; },

    // 17. 텍스트 파서 (클라이언트 즉시 실행)
    parseSalesReportText: async function(token, text, reporterName, reportDateOverride) {
      const t = String(text || '').trim();
      let type = 'order_start';
      if (/해약|중지|폐업/.test(t)) type = 'cancel';
      else if (/인상|인하/.test(t)) type = 'price_change';
      else if (/재개시/.test(t)) type = 'restart';

      const fields = {
        계약번호: (t.match(/N\d{7,8}/) || ['N'])[0],
        계약처명: (t.match(/([가-힣A-Za-z0-9]+(?:빌딩|타워|상가|의원|점|마트|약국|센터|아파트))/ ) || [''])[0],
        영업담당: reporterName || '최영국',
        담당차량: '127',
        보고일: getTzToday(),
        계약일: getTzToday(),
        개시일: getTzToday(),
        기산일: getTzToday(),
        용역료: (t.match(/(\d+)만/) ? Number(t.match(/(\d+)만/)[1]) * 10000 : 80000),
        상품: '알람',
        그로스: '일반',
        유형: '자동등록'
      };
      return { success: true, type: type, fields: fields };
    },

    parseGaJungjiText: async function(token, text) {
      const lines = String(text || '').trim().split('\n');
      const rows = [];
      for (let i = 1; i < lines.length; i++) {
        const p = lines[i].split('\t');
        if (p.length < 5) continue;
        rows.push({
          display: { 차량: p[0]||'', 계약번호: p[1]||'', 고객서비스번호: p[2]||'', 계약처명: p[3]||'', 등록일: p[4]||'', 만료일: p[5]||'', 'O/D': p[6]||'', 용역료: p[7]||'', 구분: p[8]||'', 일보등록: p[9]||'', 복구예정: p[10]||'', 대응자: p[11]||'', 담당영업: p[12]||'', 내용: p[13]||'' },
          alreadyRegistered: /^y$/i.test(String(p[9]||'').trim()),
          fields: {
            계약번호: p[1] || 'N',
            계약처명: p[3] || '',
            영업담당: p[12] || '',
            담당차량: p[0] || '',
            접수일: p[4] || getTzToday(),
            확정일: p[5] || '',
            용역료: p[7] ? Number(String(p[7]).replace(/[^0-9]/g, '')) : 80000,
            상품: '알람',
            그로스: '일반',
            해약유형: '중지',
            유형: '자동등록',
            사유: p[13] || ''
          }
        });
      }
      return { success: true, rows: rows };
    },
    // 17. 파일 저장소 관리
    adminListStoredFiles: async function(token) {
      try {
        const list = JSON.parse(localStorage.getItem('ADMIN_STORED_FILES') || '[]');
        return { success: true, files: list };
      } catch(e) {
        return { success: true, files: [] };
      }
    },

    adminUploadStoredFile: async function(token, payload) {
      try {
        let list = JSON.parse(localStorage.getItem('ADMIN_STORED_FILES') || '[]');
        list.push(payload);
        localStorage.setItem('ADMIN_STORED_FILES', JSON.stringify(list));
        return { success: true };
      } catch(e) {
        return { success: true };
      }
    },

    adminDeleteStoredFile: async function(token, id) {
      try {
        let list = JSON.parse(localStorage.getItem('ADMIN_STORED_FILES') || '[]');
        list = list.filter(function(f){ return f.id !== id; });
        localStorage.setItem('ADMIN_STORED_FILES', JSON.stringify(list));
        return { success: true };
      } catch(e) {
        return { success: true };
      }
    }
  };

  // --- google.script.run 프록시 객체 생성 ---
  function createProxy(successHandler, failureHandler) {
    return new Proxy({}, {
      get: function(target, prop) {
        if (prop === 'withSuccessHandler') {
          return function(sh) { return createProxy(sh, failureHandler); };
        }
        if (prop === 'withFailureHandler') {
          return function(fh) { return createProxy(successHandler, fh); };
        }
        return function(...args) {
          const fn = Backend[prop];
          if (typeof fn === 'function') {
            fn.apply(Backend, args)
              .then(res => { if (successHandler) successHandler(res); })
              .catch(err => { if (failureHandler) failureHandler(err); else console.error('Supabase RPC Error [' + prop + ']:', err); });
          } else {
            console.warn('Unhandled Supabase RPC call:', prop);
            if (successHandler) successHandler({ success: true });
          }
        };
      }
    });
  }

  // 전역 google.script.run 주입
  window.google = window.google || {};
  window.google.script = window.google.script || {};
  window.google.script.run = createProxy();

  console.log('✓ Supabase Backend Adapter for Google Apps Script initialized.');
})(window);
