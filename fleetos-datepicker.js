/**
 * FleetOS DatePicker Engine
 * Implementation of fleetos-datepicker.html as a reusable component.
 */

(function () {
    const MLONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const MSHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const today = new Date(); today.setHours(0, 0, 0, 0);

    let viewYear, viewMonth, selected, panel, mPanYear, dStart;
    let activeInputId = null;
    let pickerCard = null;
    let minDateConstraint = null;

    function init() {
        if (pickerCard) return;

        // Add unselectable styling to head if not present
        if (!document.getElementById('dp-extra-styles')) {
            const style = document.createElement('style');
            style.id = 'dp-extra-styles';
            style.textContent = `
                .dp-cell.dp-disabled {
                    color: #d4d4c8 !important;
                    cursor: not-allowed !important;
                    background: transparent !important;
                    opacity: 0.4;
                }
                .dp-cell.dp-disabled:hover { transform: none !important; }
            `;
            document.head.appendChild(style);
        }

        // Create Picker Card if it doesn't exist
        const div = document.createElement('div');
        div.id = 'fleetos-datepicker-card';
        div.className = 'dp-card';
        div.innerHTML = `
            <div class="dp-header">
                <div class="dp-nav" id="dpPrevBtn">‹</div>
                <div class="dp-header-centre">
                    <div class="dp-month-btn" id="dpMBtn">
                        <span class="lbl" id="dpMLabel"></span>
                        <span class="chev">▾</span>
                    </div>
                    <span class="dp-dot">·</span>
                    <div class="dp-year-btn" id="dpYBtn">
                        <span class="lbl" id="dpYLabel"></span>
                        <span class="chev">▾</span>
                    </div>
                </div>
                <div class="dp-nav" id="dpNextBtn">›</div>
            </div>
            <div class="dp-panel" id="dpMonthPanel">
                <div class="dp-panel-nav-row">
                    <div class="dp-pnav" id="dpMPrevY"><svg viewBox="0 0 10 10"><polyline points="7,1 3,5 7,9"/></svg></div>
                    <span class="dp-panel-title" id="dpMPanelYear"></span>
                    <div class="dp-pnav" id="dpMNextY"><svg viewBox="0 0 10 10"><polyline points="3,1 7,5 3,9"/></svg></div>
                </div>
                <div class="dp-month-grid" id="dpMonthGrid"></div>
            </div>
            <div class="dp-panel" id="dpYearPanel">
                <div class="dp-panel-nav-row">
                    <div class="dp-pnav" id="dpYPrevD"><svg viewBox="0 0 10 10"><polyline points="7,1 3,5 7,9"/></svg></div>
                    <span class="dp-panel-title" id="dpDecadeLabel"></span>
                    <div class="dp-pnav" id="dpYNextD"><svg viewBox="0 0 10 10"><polyline points="3,1 7,5 3,9"/></svg></div>
                </div>
                <div class="dp-year-grid" id="dpYearGrid"></div>
            </div>
            <div class="dp-day-view" id="dpDayView">
                <div class="dp-daynames">
                    <div class="dp-dayname">SU</div><div class="dp-dayname">MO</div>
                    <div class="dp-dayname">TU</div><div class="dp-dayname">WE</div>
                    <div class="dp-dayname">TH</div><div class="dp-dayname">FR</div>
                    <div class="dp-dayname">SA</div>
                </div>
                <div class="dp-divider"></div>
                <div class="dp-grid" id="dpGrid"></div>
            </div>
            <div class="dp-footer">
                <div class="dp-sel-label">Selected: <span id="dpSelDisp">—</span></div>
                <button class="dp-today-btn" id="dpTodayBtn">Today</button>
            </div>
        `;
        document.body.appendChild(div);
        pickerCard = div;

        // Bind clicks for the picker card internal logic
        document.getElementById('dpMBtn').onclick = () => togglePanel('month');
        document.getElementById('dpYBtn').onclick = () => togglePanel('year');
        document.getElementById('dpMPrevY').onclick = () => { mPanYear--; renderMonthPanel(); };
        document.getElementById('dpMNextY').onclick = () => { mPanYear++; renderMonthPanel(); };
        document.getElementById('dpYPrevD').onclick = () => { dStart -= 10; renderYearPanel(); };
        document.getElementById('dpYNextD').onclick = () => { dStart += 10; renderYearPanel(); };
        document.getElementById('dpPrevBtn').onclick = () => {
            if (panel === 'month') { mPanYear--; renderMonthPanel(); return; }
            if (panel === 'year') { dStart -= 10; renderYearPanel(); return; }
            if (--viewMonth < 0) { viewMonth = 11; viewYear--; }
            updateHeader(); renderDays();
        };
        document.getElementById('dpNextBtn').onclick = () => {
            if (panel === 'month') { mPanYear++; renderMonthPanel(); return; }
            if (panel === 'year') { dStart += 10; renderYearPanel(); return; }
            if (++viewMonth > 11) { viewMonth = 0; viewYear++; }
            updateHeader(); renderDays();
        };
        document.getElementById('dpTodayBtn').onclick = goToday;

        // Global click to close
        document.addEventListener('mousedown', (e) => {
            if (activeInputId && !pickerCard.contains(e.target)) {
                const trigger = document.getElementById(`trigger-${activeInputId}`);
                if (trigger && !trigger.contains(e.target)) {
                    closePicker();
                }
            }
        });
    }

    function openPicker(inputId, triggerEl) {
        init();
        activeInputId = inputId;

        // Logical Check: If this is Expected Arrival, constraint it by Start Date
        minDateConstraint = null;
        if (inputId === 'tripEndDate') {
            const startVal = document.getElementById('tripStartDate').value;
            if (startVal) {
                minDateConstraint = new Date(startVal);
                minDateConstraint.setHours(0, 0, 0, 0);
            }
        }

        const hiddenInput = document.getElementById(inputId);
        const val = hiddenInput.value;
        if (val) {
            selected = new Date(val);
            viewYear = selected.getFullYear();
            viewMonth = selected.getMonth();
        } else {
            selected = null;
            viewYear = today.getFullYear();
            viewMonth = today.getMonth();
        }

        // Position card
        const rect = triggerEl.getBoundingClientRect();
        pickerCard.style.top = (rect.bottom + window.scrollY + 5) + 'px';
        pickerCard.style.left = (rect.left + window.scrollX) + 'px';
        pickerCard.style.display = 'block';

        closePanel();
        updateHeader();
        renderDays();
        updateFooter();
    }

    function closePicker() {
        if (pickerCard) pickerCard.style.display = 'none';
        activeInputId = null;
    }

    function togglePanel(name) {
        if (panel === name) { closePanel(); return; }
        panel = name;
        document.getElementById('dpMonthPanel').classList.remove('visible');
        document.getElementById('dpYearPanel').classList.remove('visible');
        document.getElementById('dpMBtn').classList.remove('open');
        document.getElementById('dpYBtn').classList.remove('open');

        if (name === 'month') {
            mPanYear = viewYear;
            document.getElementById('dpMonthPanel').classList.add('visible');
            document.getElementById('dpDayView').style.display = 'none';
            document.getElementById('dpMBtn').classList.add('open');
            renderMonthPanel();
        } else {
            dStart = Math.floor(viewYear / 10) * 10;
            document.getElementById('dpYearPanel').classList.add('visible');
            document.getElementById('dpDayView').style.display = 'none';
            document.getElementById('dpYBtn').classList.add('open');
            renderYearPanel();
        }
    }

    function closePanel() {
        panel = null;
        document.getElementById('dpMonthPanel').classList.remove('visible');
        document.getElementById('dpYearPanel').classList.remove('visible');
        document.getElementById('dpDayView').style.display = '';
        document.getElementById('dpMBtn').classList.remove('remove'); // Typo in original? No, original 350-351 use remove
        document.getElementById('dpMBtn').classList.remove('open');
        document.getElementById('dpYBtn').classList.remove('open');
    }

    function renderMonthPanel() {
        document.getElementById('dpMPanelYear').textContent = mPanYear;
        const grid = document.getElementById('dpMonthGrid');
        grid.innerHTML = '';
        MSHORT.forEach((name, i) => {
            const c = document.createElement('div');
            c.className = 'dp-mcell';
            c.textContent = name;
            if (mPanYear === today.getFullYear() && i === today.getMonth()) c.classList.add('cur');
            if (mPanYear === viewYear && i === viewMonth) c.classList.add('sel');
            c.onclick = () => { viewYear = mPanYear; viewMonth = i; closePanel(); updateHeader(); renderDays(); };
            grid.appendChild(c);
        });
    }

    function renderYearPanel() {
        const end = dStart + 9;
        document.getElementById('dpDecadeLabel').textContent = `${dStart} – ${end}`;
        const grid = document.getElementById('dpYearGrid');
        grid.innerHTML = '';
        for (let y = dStart; y <= end; y++) {
            const c = document.createElement('div');
            c.className = 'dp-ycell';
            c.textContent = y;
            if (y === today.getFullYear()) c.classList.add('cur');
            if (y === viewYear) c.classList.add('sel');
            c.onclick = () => { viewYear = y; dStart = Math.floor(y / 10) * 10; closePanel(); updateHeader(); renderDays(); };
            grid.appendChild(c);
        }
    }

    function renderDays() {
        const grid = document.getElementById('dpGrid');
        grid.innerHTML = '';
        const fd = new Date(viewYear, viewMonth, 1).getDay();
        const dim = new Date(viewYear, viewMonth + 1, 0).getDate();
        const pmd = new Date(viewYear, viewMonth, 0).getDate();

        for (let i = fd - 1; i >= 0; i--)  grid.appendChild(mkCell(pmd - i, viewMonth - 1, viewYear, true));
        for (let d = 1; d <= dim; d++)      grid.appendChild(mkCell(d, viewMonth, viewYear, false));
        const fill = Math.ceil((fd + dim) / 7) * 7 - fd - dim;
        for (let d = 1; d <= fill; d++)     grid.appendChild(mkCell(d, viewMonth + 1, viewYear, true));
    }

    function mkCell(day, month, year, other) {
        const date = new Date(year, month, day);
        const c = document.createElement('div');
        c.className = 'dp-cell';
        c.textContent = day;
        const dow = date.getDay();
        if (dow === 0 || dow === 6) c.classList.add('dp-wknd');
        if (other) { c.classList.add('dp-om'); return c; }

        // Constraint check
        if (minDateConstraint && date < minDateConstraint) {
            c.classList.add('dp-disabled');
            return c;
        }

        if (date.getTime() === today.getTime()) c.classList.add('dp-td');
        if (selected && date.getTime() === selected.getTime()) c.classList.add('dp-sel');
        c.onclick = () => {
            selected = date;
            renderDays();
            updateFooter();
            updateTriggerValues();
            closePicker();
        };
        return c;
    }

    function updateHeader() {
        document.getElementById('dpMLabel').textContent = MLONG[viewMonth];
        document.getElementById('dpYLabel').textContent = viewYear;
    }

    function updateFooter() {
        const el = document.getElementById('dpSelDisp');
        el.innerHTML = selected
            ? `<span>${String(selected.getDate()).padStart(2, '0')} ${MSHORT[selected.getMonth()]} ${selected.getFullYear()}</span>`
            : '—';
    }

    function updateTriggerValues() {
        if (!activeInputId) return;
        const hiddenInput = document.getElementById(activeInputId);
        const trigger = document.getElementById(`trigger-${activeInputId}`);
        const trigVal = trigger.querySelector('.dp-trigger-val');

        if (selected) {
            const fmt = `${String(selected.getDate()).padStart(2, '0')} ${MSHORT[selected.getMonth()]} ${selected.getFullYear()}`;

            // Fix Timezone Issue: Use Local Date string YYYY-MM-DD
            const yyyy = selected.getFullYear();
            const mm = String(selected.getMonth() + 1).padStart(2, '0');
            const dd = String(selected.getDate()).padStart(2, '0');
            const localDateStr = `${yyyy}-${mm}-${dd}`;

            hiddenInput.value = localDateStr;
            if (trigVal) trigVal.textContent = fmt;
            
            // UPDATE NEW CREATIVE JOURNEY LABELS
            const jtVal = document.getElementById("val-" + activeInputId);
            if (jtVal) {
                jtVal.textContent = fmt;
                jtVal.classList.remove("empty");
            }
            
            trigger.classList.add('has-value');

            // Logical Cross-Check for Trips: If Start Date changed, validate Expected Arrival
            if (activeInputId === 'tripStartDate') {
                const endInput = document.getElementById('tripEndDate');
                const endTrigger = document.getElementById('trigger-tripEndDate');
                if (endInput && endInput.value) {
                    const currentEndDate = new Date(endInput.value);
                    currentEndDate.setHours(0, 0, 0, 0);

                    if (currentEndDate < selected) {
                        // Reset End Date as it's now invalid
                        endInput.value = "";
                        if (endTrigger) {
                            const etv = endTrigger.querySelector('.dp-trigger-val');
                            if (etv) etv.textContent = "Select date";
                            
                            const ejv = document.getElementById("val-tripEndDate");
                            if (ejv) {
                                ejv.textContent = "Select date";
                                ejv.classList.add("empty");
                            }
                            
                            endTrigger.classList.remove('has-value');
                        }
                    }
                }
            }
        } else {
            hiddenInput.value = "";
            if (trigVal) trigVal.textContent = "Select a date";
            const jtVal = document.getElementById("val-" + activeInputId);
            if (jtVal) {
                jtVal.textContent = "Select date";
                jtVal.classList.add("empty");
            }
            trigger.classList.remove('has-value');
        }

        // Trigger onchange for the hidden input
        hiddenInput.dispatchEvent(new Event('change'));
    }

    function goToday() {
        viewYear = today.getFullYear(); viewMonth = today.getMonth();
        selected = new Date(today); closePanel();
        updateHeader(); renderDays(); updateFooter(); updateTriggerValues();
        closePicker();
    }

    window.setFleetOSDatePickerValue = function (inputId, date) {
        if (!date) return;
        selected = new Date(date);
        activeInputId = inputId;
        updateTriggerValues();
        activeInputId = null;
    };

    window.attachFleetOSDatePicker = function (inputId) {
        const hiddenInput = document.getElementById(inputId);
        if (!hiddenInput) return;

        const trigger = document.getElementById(`trigger-${inputId}`);
        if (!trigger) return;

        trigger.onclick = () => openPicker(inputId, trigger);

        const clearBtn = trigger.querySelector('.dp-trigger-clear');
        if (clearBtn) {
            clearBtn.onclick = (e) => {
                e.stopPropagation();
                selected = null;
                activeInputId = inputId;
                updateTriggerValues();
                renderDays();
                activeInputId = null;
            };
        }
    };
})();
