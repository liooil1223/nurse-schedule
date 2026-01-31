import { useMemo, useState } from "react";
import "./App.css";

type ShiftCode = "D" | "E" | "N" | "O"; // Day/Evening/Night/Off

type Rules = {
  maxShiftsPerDay: 1 | 2;
  maxConsecutiveWorkDays: number; // 연속 근무일 제한
  maxWeeklyWorkDays: number; // 주당 근무일 제한
  preferOffOnWeekend: boolean; // 주말 OFF 선호
};

type Cell = {
  date: Date;
  inMonth: boolean;
  shift: ShiftCode;
};

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function endOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}

function addDays(d: Date, days: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  return x;
}

function getMondayBasedWeekday(d: Date) {
  // Mon=0 ... Sun=6
  const dow = d.getDay(); // Sun=0..Sat=6
  return (dow + 6) % 7;
}

function formatYYYYMM(d: Date) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
}

function shiftLabel(s: ShiftCode) {
  switch (s) {
    case "D":
      return "D";
    case "E":
      return "E";
    case "N":
      return "N";
    case "O":
      return "OFF";
  }
}

function nextShift(s: ShiftCode): ShiftCode {
  // 클릭하면 D->E->N->OFF->D 순환
  if (s === "D") return "E";
  if (s === "E") return "N";
  if (s === "N") return "O";
  return "D";
}

// 아주 단순한 “샘플 자동배치”: 규칙을 완벽히 만족시키는 최적화는 아니고,
// 화면용으로 대략적 패턴(DDENOFF...)을 생성하고, 주말 OFF 선호를 약간 반영.
function generateSampleMonthCells(anchor: Date, rules: Rules): Cell[] {
  const start = startOfMonth(anchor);
  const end = anchor ? endOfMonth(anchor) : null;

  // 캘린더는 월요일 시작 6주(42칸)로 고정
  const first = start;
  const offset = getMondayBasedWeekday(first);
  const gridStart = addDays(first, -offset);

  const pattern: ShiftCode[] = ["D", "D", "E", "N", "O", "O"];
  let p = 0;

  const cells: Cell[] = [];
  for (let i = 0; i < 42; i++) {
    const date = addDays(gridStart, i);
    const inMonth = date.getMonth() === anchor.getMonth();

    let shift: ShiftCode = pattern[p % pattern.length];
    p++;

    // 주말 OFF 선호(가벼운 반영): 토/일은 OFF로 바꿀 확률을 높임
    const dow = date.getDay(); // 0 Sun, 6 Sat
    const isWeekend = dow === 0 || dow === 6;
    if (rules.preferOffOnWeekend && isWeekend && inMonth) {
      shift = "O";
    }

    cells.push({ date, inMonth, shift });
  }
  return cells;
}

function countConsecutiveWorkDays(cellsInMonth: Cell[]) {
  // D/E/N을 "근무", O를 "비근무"로 간주해 최대 연속 근무일을 계산
  let max = 0;
  let cur = 0;
  for (const c of cellsInMonth) {
    if (c.shift === "O") {
      cur = 0;
    } else {
      cur++;
      if (cur > max) max = cur;
    }
  }
  return max;
}

function countWeeklyWorkDays(cellsInMonth: Cell[], monthAnchor: Date) {
  // 월 내 날짜만 대상으로 ISO 유사(월요일 시작) 주 단위로 근무일 수 집계
  const byWeek = new Map<string, number>();
  for (const c of cellsInMonth) {
    const d = c.date;
    if (d.getMonth() !== monthAnchor.getMonth()) continue;

    // week key: YYYY-MM + weekIndexWithinGrid(대충)
    const mondayBased = getMondayBasedWeekday(d);
    const monday = addDays(d, -mondayBased);
    const key = `${monday.getFullYear()}-${pad2(monday.getMonth() + 1)}-${pad2(monday.getDate())}`;

    const isWork = c.shift !== "O";
    byWeek.set(key, (byWeek.get(key) ?? 0) + (isWork ? 1 : 0));
  }
  return Array.from(byWeek.entries()).sort((a, b) => a[0].localeCompare(b[0]));
}

export default function App() {
  const [userName, setUserName] = useState("홍길동");
  const [monthAnchor, setMonthAnchor] = useState(() => new Date());
  const [rules, setRules] = useState<Rules>({
    maxShiftsPerDay: 1,
    maxConsecutiveWorkDays: 5,
    maxWeeklyWorkDays: 5,
    preferOffOnWeekend: true,
  });

  const [cells, setCells] = useState<Cell[]>(() =>
    generateSampleMonthCells(monthAnchor, rules)
  );

  // 월/규칙이 바뀌면 샘플 스케줄 다시 생성
  const regenerate = () => {
    setCells(generateSampleMonthCells(monthAnchor, rules));
  };

  const monthCellsInMonth = useMemo(
    () => cells.filter((c) => c.inMonth),
    [cells]
  );

  const kpis = useMemo(() => {
    const totalWork = monthCellsInMonth.filter((c) => c.shift !== "O").length;
    const totalOff = monthCellsInMonth.filter((c) => c.shift === "O").length;
    const maxCons = countConsecutiveWorkDays(monthCellsInMonth);
    const weekly = countWeeklyWorkDays(cells, monthAnchor);
    const maxWeekly = weekly.reduce((m, [, v]) => Math.max(m, v), 0);

    return { totalWork, totalOff, maxCons, maxWeekly, weekly };
  }, [monthCellsInMonth, cells, monthAnchor]);

  const prevMonth = () => setMonthAnchor((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1));
  const nextMonth = () => setMonthAnchor((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1));

  // monthAnchor 변경 시 cells 재생성을 원하면 아래 useEffect 대신 버튼에서 regenerate 누르게 해도 됨.
  // 여기서는 월이 바뀌면 자동 재생성되게 처리
  // (규칙은 사용자가 수정 후 "적용" 누르게)
  useMemo(() => {
    setCells(generateSampleMonthCells(monthAnchor, rules));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monthAnchor]);

  const onClickCell = (idx: number) => {
    setCells((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], shift: nextShift(next[idx].shift) };
      return next;
    });
  };

  const weekDays = ["월", "화", "수", "목", "금", "토", "일"];

  const ruleViolation = useMemo(() => {
    const violations: string[] = [];

    if (kpis.maxCons > rules.maxConsecutiveWorkDays) {
      violations.push(
        `연속 근무일 최대값(${kpis.maxCons})이 제한(${rules.maxConsecutiveWorkDays})을 초과`
      );
    }
    if (kpis.maxWeekly > rules.maxWeeklyWorkDays) {
      violations.push(
        `주당 근무일 최대값(${kpis.maxWeekly})이 제한(${rules.maxWeeklyWorkDays})을 초과`
      );
    }
    return violations;
  }, [kpis.maxCons, kpis.maxWeekly, rules.maxConsecutiveWorkDays, rules.maxWeeklyWorkDays]);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <div className="title">Nurse Schedule</div>
          <div className="subtitle">근무표 생성/관리</div>
        </div>

        <div className="userBox">
          <label className="label">사용자</label>
          <input
            className="input"
            value={userName}
            onChange={(e) => setUserName(e.target.value)}
            placeholder="이름 입력"
          />
        </div>
      </header>

      <main className="layout">
        <section className="panel">
          <div className="panelHeader">
            <div className="panelTitle">규칙 설정</div>
            <button className="btn" onClick={regenerate}>규칙 적용</button>
          </div>

          <div className="form">
            <div className="formRow">
              <label className="label">1일 최대 근무</label>
              <select
                className="select"
                value={rules.maxShiftsPerDay}
                onChange={(e) =>
                  setRules((r) => ({ ...r, maxShiftsPerDay: Number(e.target.value) as 1 | 2 }))
                }
              >
                <option value={1}>1회</option>
                <option value={2}>2회</option>
              </select>
            </div>

            <div className="formRow">
              <label className="label">연속 근무일 제한</label>
              <input
                className="input"
                type="number"
                min={1}
                max={31}
                value={rules.maxConsecutiveWorkDays}
                onChange={(e) =>
                  setRules((r) => ({ ...r, maxConsecutiveWorkDays: Number(e.target.value) }))
                }
              />
            </div>

            <div className="formRow">
              <label className="label">주당 최대 근무일</label>
              <input
                className="input"
                type="number"
                min={1}
                max={7}
                value={rules.maxWeeklyWorkDays}
                onChange={(e) =>
                  setRules((r) => ({ ...r, maxWeeklyWorkDays: Number(e.target.value) }))
                }
              />
            </div>

            <div className="formRow formRowInline">
              <label className="label">주말 OFF 선호</label>
              <input
                type="checkbox"
                checked={rules.preferOffOnWeekend}
                onChange={(e) =>
                  setRules((r) => ({ ...r, preferOffOnWeekend: e.target.checked }))
                }
              />
            </div>
          </div>

          <div className="kpi">
            <div className="kpiTitle">요약</div>
            <div className="kpiGrid">
              <div className="kpiItem">
                <div className="kpiLabel">이름</div>
                <div className="kpiValue">{userName || "-"}</div>
              </div>
              <div className="kpiItem">
                <div className="kpiLabel">근무일</div>
                <div className="kpiValue">{kpis.totalWork}</div>
              </div>
              <div className="kpiItem">
                <div className="kpiLabel">OFF</div>
                <div className="kpiValue">{kpis.totalOff}</div>
              </div>
              <div className="kpiItem">
                <div className="kpiLabel">최대 연속근무</div>
                <div className="kpiValue">{kpis.maxCons}</div>
              </div>
              <div className="kpiItem">
                <div className="kpiLabel">주당 최대근무</div>
                <div className="kpiValue">{kpis.maxWeekly}</div>
              </div>
            </div>

            {ruleViolation.length > 0 && (
              <div className="warn">
                <div className="warnTitle">규칙 위반</div>
                <ul className="warnList">
                  {ruleViolation.map((v) => (
                    <li key={v}>{v}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </section>

        <section className="panel panelWide">
          <div className="panelHeader">
            <div className="panelTitle">근무표 ({formatYYYYMM(monthAnchor)})</div>
            <div className="toolbar">
              <button className="btn ghost" onClick={prevMonth}>이전</button>
              <button className="btn ghost" onClick={nextMonth}>다음</button>
            </div>
          </div>

          <div className="calendar">
            <div className="weekHeader">
              {weekDays.map((w) => (
                <div key={w} className="weekCell">{w}</div>
              ))}
            </div>

            <div className="grid">
              {cells.map((c, idx) => {
                const d = c.date;
                const day = d.getDate();
                const isWeekend = d.getDay() === 0 || d.getDay() === 6;

                return (
                  <button
                    key={`${d.toISOString()}-${idx}`}
                    className={[
                      "cell",
                      c.inMonth ? "inMonth" : "outMonth",
                      isWeekend ? "weekend" : "",
                      c.shift === "O" ? "off" : "work",
                    ].join(" ")}
                    onClick={() => onClickCell(idx)}
                    title="클릭하면 D→E→N→OFF 순환"
                  >
                    <div className="cellTop">
                      <span className="day">{day}</span>
                    </div>
                    <div className="shift">{shiftLabel(c.shift)}</div>
                  </button>
                );
              })}
            </div>

            <div className="hint">
              <span className="pill">클릭: D → E → N → OFF</span>
              <span className="pill">규칙 적용 버튼을 누르면 샘플 스케줄 재생성</span>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
