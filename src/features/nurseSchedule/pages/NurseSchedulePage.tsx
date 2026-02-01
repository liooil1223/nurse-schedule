import React from "react";

type UserRow = {
  id: string;
  name: string;
};

type State = {
  rulesText: string;
  users: UserRow[];

  // 생성 결과
  days: number;
  dates: string[];
  scheduleByUser: Record<string, string[]>;

  error?: string;
};

/** helpers */
function formatDate(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function addDays(d: Date, days: number): Date {
  const nd = new Date(d);
  nd.setDate(nd.getDate() + days);
  return nd;
}

type Shift = "D" | "E" | "N" | "O";

type User = { id: string; name: string };

type GenerateOptions = {
  year: number;
  month: number; // 1~12
  // 하루 필요 인원(슬롯). users 수와 안 맞으면 자동 보정 로직에서 처리
  need: { N: number; E: number; O: number }; // D는 남는 인원
  // 제약
  maxConsecutiveWork: number; // 연속 근무 최대 (D/E/N을 근무로 간주)
  maxConsecutiveNight: number; // 연속 야간 최대
  nightThenOff: boolean; // 야간 다음날 O 강제(권장 아님, 강제)
  // 탐색
  trials: number; // 랜덤 시도 횟수
};

function getMonthDates(year: number, month: number): string[] {
  // month: 1~12
  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 0);
  const days = end.getDate();
  const dates: string[] = [];
  for (let d = 1; d <= days; d++) {
    const dt = new Date(year, month - 1, d);
    const yyyy = dt.getFullYear();
    const mm = String(dt.getMonth() + 1).padStart(2, "0");
    const dd = String(dt.getDate()).padStart(2, "0");
    dates.push(`${yyyy}-${mm}-${dd}`);
  }
  return dates;
}

function isWork(shift: Shift): boolean {
  return shift !== "O";
}

// 간단 난수 섞기
function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function generateOne(users: User[], dates: string[], opt: GenerateOptions) {
  const scheduleByUser: Record<string, Shift[]> = {};
  users.forEach((u) => (scheduleByUser[u.id] = []));

  const countByUser: Record<string, Record<Shift, number>> = {};
  users.forEach((u) => (countByUser[u.id] = { D: 0, E: 0, N: 0, O: 0 }));

  // ✅ 야간 블록 제약 상태
  // nightRemain: "오늘 N을 주고 난 뒤" 앞으로 추가로 더 N을 줘야 하는 횟수(=블록 잔여)
  // offTomorrow: 오늘 배정이 끝난 뒤, 내일 O를 강제로 줘야 하는 플래그
  const nightRemainByUser: Record<string, number> = {};
  const offTomorrowByUser: Record<string, boolean> = {};
  users.forEach((u) => {
    nightRemainByUser[u.id] = 0;
    offTomorrowByUser[u.id] = false;
  });

  // 셔플
  const shuffle = <T,>(arr: T[]) => {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };

  let score = 0;

  for (let dayIdx = 0; dayIdx < dates.length; dayIdx++) {
    const uCount = users.length;

    // 목표 슬롯(soft target) — 필요시 초과/미달 허용
    let needN = Math.min(opt.need.N, uCount);
    let needE = Math.min(opt.need.E, uCount);
    let needO = Math.min(opt.need.O, uCount);

    // 오늘 배정(강제 먼저)
    const todayAssign: Record<string, Shift> = {};

    // 1) ✅ "오늘 반드시 O" 강제
    for (const u of users) {
      if (offTomorrowByUser[u.id]) {
        todayAssign[u.id] = "O";
      }
    }

    // 2) ✅ "오늘 반드시 N" 강제(야간 블록 진행 중)
    for (const u of users) {
      if (todayAssign[u.id] == null && nightRemainByUser[u.id] > 0) {
        todayAssign[u.id] = "N";
      }
    }

    // 3) 오늘 남은 사용자 목록
    const unassigned = users.filter((u) => todayAssign[u.id] == null);
    const userOrder = shuffle(unassigned);

    // 4) 남은 인원에 대해 D/E/N/O를 채움
    //    단, N은 "시작하면 2~3 연속"이므로 "시작"할 때 블록 길이를 결정해 nightRemain에 반영
    for (const u of userOrder) {
      const uid = u.id;
      const prev = scheduleByUser[uid];
      const last = prev[prev.length - 1]; // 어제 근무

      // 후보 shift들
      const candidates: Shift[] = ["D", "E", "N", "O"];

      let best: Shift = "D";
      let bestCost = Number.POSITIVE_INFINITY;

      for (const s of candidates) {
        let cost = 0;

        // ====== ✅ 하드 제약 ======
        // (A) N 다음날은 N(연속) 또는 O(종료 후)만 가능. D/E 금지.
        if (last === "N" && (s === "D" || s === "E")) cost += 1_000_000;

        // (B) offTomorrow 플래그가 있으면 오늘은 O 강제인데, 이 루프는 unassigned만 돌므로 사실상 안전장치
        if (offTomorrowByUser[uid] && s !== "O") cost += 1_000_000;

        // (C) nightRemain > 0인 사람은 오늘 N 강제인데, 이 루프는 unassigned만 돌므로 안전장치
        if (nightRemainByUser[uid] > 0 && s !== "N") cost += 1_000_000;

        // (D) N "시작"은 월말 처리 필요:
        // 블록(2~3일) + 종료 후 다음날 O까지 확보해야 하므로 남은 일수가 부족하면 시작 금지
        if (s === "N" && last !== "N") {
          const minNeedDays = 2 /*N block 최소*/ + 1 /*다음날 O*/;
          const remaining = dates.length - dayIdx;
          if (remaining < minNeedDays) cost += 1_000_000;
        }

        // ====== 소프트(점수) ======
        // 목표 need에 맞추고 싶으면 가벼운 가중치로 유도
        // (강제 N/O로 인해 초과되는 날이 있을 수 있으니 "절대 제한"은 하지 않음)
        const alreadyN = Object.values(todayAssign).filter((x) => x === "N").length;
        const alreadyE = Object.values(todayAssign).filter((x) => x === "E").length;
        const alreadyO = Object.values(todayAssign).filter((x) => x === "O").length;

        if (s === "N" && alreadyN >= needN) cost += 200;
        if (s === "E" && alreadyE >= needE) cost += 120;
        if (s === "O" && alreadyO >= needO) cost += 80;

        // 사용자 편중 방지
        cost += countByUser[uid][s] * 2;

        if (cost < bestCost) {
          bestCost = cost;
          best = s;
        }
      }

      todayAssign[uid] = best;
    }

    // 5) ✅ 오늘 배정 반영 + 야간 블록 상태 업데이트
    for (const u of users) {
      const uid = u.id;
      const s = (todayAssign[uid] ?? "O") as Shift;

      scheduleByUser[uid].push(s);
      countByUser[uid][s]++;

      // 오늘 시작 시점에서 offTomorrow는 "오늘 O 강제"로 이미 사용했으니 초기화
      if (offTomorrowByUser[uid]) offTomorrowByUser[uid] = false;

      // 야간 블록 진행
      if (s === "N") {
        if (nightRemainByUser[uid] > 0) {
          // 블록 진행 중: 잔여 N 감소
          nightRemainByUser[uid] -= 1;

          // 블록이 끝났으면 "내일 O" 강제
          if (nightRemainByUser[uid] === 0) {
            offTomorrowByUser[uid] = true;
          }
        } else {
          // ✅ N을 새로 시작(어제 N이 아니었음) → 2~3일 블록 길이 결정
          const blockLen = Math.random() < 0.5 ? 2 : 3; // 2 or 3
          nightRemainByUser[uid] = blockLen - 1; // 오늘 이미 1일 했으니 남은 N 횟수

          // blockLen=2면 nightRemain=1 → 내일 N 후 종료 → 그 다음날 O 강제
          // blockLen=3면 nightRemain=2 → 2일 더 N 후 종료 → 다음날 O 강제
        }
      } else {
        // N이 아닌 날에는 nightRemain가 있으면 안 되지만(강제 로직상), 안전장치
        if (nightRemainByUser[uid] > 0) {
          score += 50_000; // 사실상 불가능하지만 혹시 모를 방어
        }
      }
    }
  }

  return { scheduleByUser, score };
}


export function generateMonthlySchedule(users: User[], opt: GenerateOptions) {
  const dates = getMonthDates(opt.year, opt.month);
  if (users.length === 0) return { dates, scheduleByUser: {}, score: 0 };

  let best: { scheduleByUser: Record<string, Shift[]>; score: number } | null = null;

  for (let t = 0; t < opt.trials; t++) {
    const candidate = generateOne(users, dates, opt);
    if (!best || candidate.score < best.score) best = candidate;
  }

  return { dates, scheduleByUser: best!.scheduleByUser, score: best!.score };
}


function uid(): string {
  // 간단 UID(충돌 가능성 낮음)
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export default class NurseSchedulePage extends React.Component<{}, State> {
  state: State = {
    rulesText: "",
    users: [{ id: uid(), name: "" }], // 처음에 1칸은 기본 제공

    days: 14,
    dates: [],
    scheduleByUser: {},
    error: undefined,
  };

  onChangeRulesText = (v: string) => this.setState({ rulesText: v });

  addUserField = () => {
    this.setState((prev) => ({
      users: [...prev.users, { id: uid(), name: "" }],
    }));
  };

  removeUserField = (id: string) => {
    this.setState((prev) => {
      const users = prev.users.filter((u) => u.id !== id);
      const nextUsers = users.length === 0 ? [{ id: uid(), name: "" }] : users;

      // 결과도 함께 정리
      const { [id]: _, ...rest } = prev.scheduleByUser;

      return {
        users: nextUsers,
        scheduleByUser: rest,
      };
    });
  };

  onChangeUserName = (id: string, name: string) => {
    this.setState((prev) => ({
      users: prev.users.map((u) => (u.id === id ? { ...u, name } : u)),
    }));
  };

  onGenerate = () => {
    try {
      // 1) 사용자 목록 정리(빈칸 제거)
      const validUsers = this.state.users
        .map((u) => ({ ...u, name: u.name.trim() }))
        .filter((u) => u.name.length > 0);
  
      if (validUsers.length === 0) {
        this.setState({ error: "사용자명을 최소 1명 입력하세요." });
        return;
      }
  
      // 2) 옵션: 이번달 자동
      const now = new Date();
      const year = now.getFullYear();
      const month = now.getMonth() + 1; // 1~12
  
      // 3) 스케줄 생성 호출 (여기가 “호출 지점”)
      const { dates, scheduleByUser, score } = generateMonthlySchedule(validUsers, {
        year,
        month,
        need: { N: 1, E: 1, O: 0 },     // ← 여기만 너희 병동 룰로 조정
        maxConsecutiveWork: 6,
        maxConsecutiveNight: 2,
        nightThenOff: true,
        trials: 300,
      });
  
      // 4) state 반영
      this.setState({
        users: this.state.users.map((u) => ({ ...u, name: u.name.trim() })), // 보기 좋게 trim
        dates,
        scheduleByUser,
        error: undefined,
        // 점수 표시하고 싶으면 state에 score 추가해도 됨
      });
  
      // console.log("best score:", score);
    } catch (e) {
      this.setState({
        dates: [],
        scheduleByUser: {},
        error: e instanceof Error ? e.message : "알 수 없는 오류",
      });
    }
  };
  

  private parsePattern(rulesText: string): string[] {
    const raw = rulesText.trim();
    if (!raw) return [];

    const tokens = raw
      .split(/[, \t\r\n\-\/]+/g)
      .map((t) => t.trim())
      .filter(Boolean);

    const allowed = new Set(["D", "N", "O", "E"]);
    const pattern = tokens.map((t) => t.toUpperCase());

    const invalid = pattern.find((p) => !allowed.has(p));
    if (invalid) throw new Error(`허용되지 않은 근무 코드: ${invalid} (허용: D,N,O,E)`);

    return pattern;
  }

  render() {
    const { rulesText, users, dates, scheduleByUser, error } = this.state;
  
    return (
      <div
        style={{
          height: "100vh",
          width: "100%",
          display: "flex",
          flexDirection: "column",
          padding: 16,
          boxSizing: "border-box",
        }}
      >
        {/* 상단 20% 헤더 */}
        <header
          style={{
            flex: "0 0 20vh",
            minHeight: 120,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            borderBottom: "1px solid #ddd",
            padding: "8px 0",
            boxSizing: "border-box",
            width: "100%",
            overflowX: "hidden", // ✅ 상단은 절대 가로로 안 늘어나게
          }}
        >
          <h2 style={{ margin: 0 }}>Nurse Schedule</h2>
        </header>
  
        {/* 하단 영역 */}
        <main
          style={{
            flex: 1,
            width: "100%",
            display: "flex",
            flexDirection: "column",
            gap: 12,
            paddingTop: 12,
            boxSizing: "border-box",
            overflow: "hidden", // ✅ main 자체는 스크롤 금지
            minWidth: 0,        // ✅ 중요: 자식이 커져도 부모가 안 늘어남
          }}
        >
          {/* 입력/버튼 영역(영향 받지 않게 가로 넘침 차단) */}
          <section
            style={{
              flex: "0 0 auto",
              width: "100%",
              minWidth: 0,
              maxWidth: "500px",
              overflowX: "hidden", // ✅ 여기서 가로 확장 차단
              display: "flex",
              flexDirection: "column",
              gap: 10,
              paddingBottom: 10,
              borderBottom: "1px solid #eee",
              boxSizing: "border-box",
            }}
          >
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end", minWidth: 0 }}>
              <label style={{ display: "grid", gap: 6, flex: "1 1 480px", minWidth: 0 }}>
                패턴 입력 (예: D,N,O)
                <textarea
                  value={rulesText}
                  onChange={(e) => this.onChangeRulesText(e.target.value)}
                  rows={2}
                  style={{ width: "100%", resize: "vertical", boxSizing: "border-box" }}
                  placeholder="예) D,N,O 또는 D N O 또는 D-N-O"
                />
              </label>
  
              <button onClick={this.onGenerate} style={{ width: 120, height: 34, flex: "0 0 auto" }}>
                생성
              </button>
            </div>
  
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <div style={{ fontWeight: 600 }}>사용자</div>
              <button onClick={this.addUserField} style={{ height: 30 }}>
                사용자 추가
              </button>
            </div>
  
            <div style={{ display: "grid", gap: 8 }}>
              {users.map((u, idx) => (
                <div key={u.id} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <div style={{ width: 28, textAlign: "right" }}>{idx + 1}.</div>
                  <input
                    value={u.name}
                    onChange={(e) => this.onChangeUserName(u.id, e.target.value)}
                    placeholder="사용자명 입력"
                    style={{ width: 240 }}
                  />
                  <button onClick={() => this.removeUserField(u.id)} style={{ height: 30 }}>
                    삭제
                  </button>
                </div>
              ))}
            </div>
  
            {error && <div style={{ color: "red" }}>{error}</div>}
          </section>
  
          {/* ✅ 근무표 영역만 스크롤 */}
          <section
            style={{
              flex: 1,
              width: "100%",
              maxWidth: "100%",  // ✅ 부모 폭 고정
              minWidth: 0,       // ✅ 중요
              minHeight: 0,      // ✅ 세로 스크롤을 위해 필수
              overflow: "hidden",
              boxSizing: "border-box",
            }}
          >
            <div
              style={{
                width: "100%",
                maxWidth: "100%", // ✅ 여기서도 폭 고정
                height: "100%",
                minWidth: 0,
                overflowX: "auto", // ✅ 가로 스크롤은 여기서만
                overflowY: "auto",
              }}
            >
              {dates.length === 0 ? (
                <div>생성된 근무표가 없습니다.</div>
              ) : (
                // ✅ 테이블을 inline-block처럼 만들어 “자기만 커지고” 부모는 안 밀게
                <div style={{ display: "inline-block" }}>
                  <table
                    border={1}
                    cellPadding={8}
                    style={{
                      borderCollapse: "collapse",
                      tableLayout: "fixed",
                      width: "max-content",
                    }}
                  >
                    <thead>
                      <tr>
                        <th style={{ width: 160 }}>사용자</th>
                        {dates.map((d) => (
                          <th key={d} style={{ minWidth: 90 }}>
                            {d}
                          </th>
                        ))}
                      </tr>
                    </thead>
  
                    <tbody>
                      {users
                        .map((u) => ({ ...u, name: u.name.trim() }))
                        .filter((u) => u.name.length > 0)
                        .map((u) => {
                          const shifts = scheduleByUser[u.id] ?? [];
                          return (
                            <tr key={u.id}>
                              <td style={{ fontWeight: 600 }}>{u.name}</td>
                              {dates.map((d, i) => (
                                <td key={`${u.id}-${d}`}>{shifts[i] ?? ""}</td>
                              ))}
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </section>
        </main>
      </div>
    );
  }
  
  
  
}
