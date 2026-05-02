import data from "../public/data/latest-run.json";

const protocols = [
  { key: "aave", name: "Aave", color: "#2563eb" },
  { key: "morpho", name: "Morpho", color: "#16a34a" },
  { key: "yearn", name: "Yearn", color: "#7c3aed" },
  { key: "sky", name: "Sky", color: "#d97706" },
];

function formatDate(value) {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "medium",
  }).format(new Date(value));
}

function formatUsdc(value) {
  return `${Number(value).toFixed(value < 0.1 && value > 0 ? 2 : 2)} USDC`;
}

function shortHash(hash) {
  return `${hash.slice(0, 10)}...${hash.slice(-8)}`;
}

function allocationRows(allocation, amounts) {
  return protocols.map((protocol) => ({
    ...protocol,
    pct: allocation[protocol.key],
    amount: amounts[protocol.key],
  }));
}

function amountsFromAllocation(allocation, poolAmount = data.asset.poolAmount) {
  return Object.fromEntries(
    protocols.map((protocol) => [
      protocol.key,
      Number(((poolAmount * (allocation[protocol.key] ?? 0)) / 100).toFixed(6)),
    ]),
  );
}

function StatusPill({ children, tone = "green" }) {
  return <span className={`pill pill-${tone}`}>{children}</span>;
}

function AllocationBar({ rows }) {
  return (
    <div className="allocationBar" aria-label="Allocation split">
      {rows.map((row) => (
        <div
          key={row.key}
          className="allocationSegment"
          style={{ width: `${row.pct}%`, backgroundColor: row.color }}
          title={`${row.name}: ${row.pct}%`}
        />
      ))}
    </div>
  );
}

function AllocationList({ rows }) {
  return (
    <div className="allocationList">
      {rows.map((row) => (
        <div className="allocationItem" key={row.key}>
          <div className="protocolLabel">
            <span className="swatch" style={{ backgroundColor: row.color }} />
            <span>{row.name}</span>
          </div>
          <div className="protocolNumbers">
            <strong>{row.pct}%</strong>
            <span>{formatUsdc(row.amount)}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function HashLink({ tx }) {
  return (
    <a href={tx.url} target="_blank" rel="noreferrer" className="hashLink">
      {shortHash(tx.hash)}
    </a>
  );
}

export default function Dashboard() {
  const freshRows = allocationRows(data.freshAllocation.allocation, data.freshAllocation.amounts);
  const rebalanceRows = allocationRows(data.rebalance.targetAllocation, data.rebalance.targetAmounts);
  const totalDelta = data.rebalance.deltas.reduce((sum, item) => sum + Math.abs(item.deltaUsdc), 0);
  const history = data.history ?? [];
  const rebalanceHistory = history.filter((item) => item.type === "rebalance");
  const totalApyLift = rebalanceHistory.reduce((sum, item) => sum + item.expectedApyLift, 0);
  const bestApy = Math.max(...history.map((item) => item.expectedApy ?? 0));

  return (
    <main className="pageShell">
      <section className="hero">
        <div>
          <div className="eyebrow">EvoYield live allocation dashboard</div>
          <h1>1 USDC test pool allocated and monitored for rebalance</h1>
          <p className="heroText">
            0G selected the target percentages, KeeperHub executed the fresh allocation, and three
            follow-up rebalances moved the same 1 USDC test pool as market APYs changed.
          </p>
        </div>
        <div className="heroMeta">
          <StatusPill>Workflow healthy</StatusPill>
          <div className="metaLine">
            <span>Workflow</span>
            <strong>{data.workflow.id}</strong>
          </div>
          <div className="metaLine">
            <span>Wallet</span>
            <strong>{shortHash(data.wallet)}</strong>
          </div>
        </div>
      </section>

      <section className="summaryGrid">
        <div className="metric">
          <span>Pool size</span>
          <strong>{data.asset.poolAmount} USDC</strong>
          <p>{data.chain}</p>
        </div>
        <div className="metric">
          <span>0G strategy</span>
          <strong>Gen {data.strategy.generation}</strong>
          <p>Fitness {data.strategy.fitnessScore}/100</p>
        </div>
        <div className="metric">
          <span>Latest rebalance</span>
          <strong>{totalDelta === 0 ? "No movement" : formatUsdc(totalDelta)}</strong>
          <p>{formatDate(data.rebalance.timestamp)}</p>
        </div>
        <div className="metric">
          <span>Estimated APY lift</span>
          <strong>+{totalApyLift.toFixed(2)} pts</strong>
          <p>Across {rebalanceHistory.length} KeeperHub rebalances</p>
        </div>
      </section>

      <section className="contentGrid">
        <article className="panel panelWide">
          <div className="panelHeader">
            <div>
              <p className="sectionKicker">Fresh allocation</p>
              <h2>Initial split from 0G recommendation</h2>
            </div>
            <StatusPill>Executed</StatusPill>
          </div>
          <AllocationBar rows={freshRows} />
          <AllocationList rows={freshRows} />
          <div className="detailStrip">
            <div>
              <span>Timestamp</span>
              <strong>{formatDate(data.freshAllocation.timestamp)}</strong>
            </div>
            <div>
              <span>KeeperHub execution</span>
              <strong>{data.freshAllocation.executionId}</strong>
            </div>
          </div>
        </article>

        <article className="panel">
          <div className="panelHeader">
            <div>
              <p className="sectionKicker">Market APY</p>
              <h2>Inputs used by the agent</h2>
            </div>
          </div>
          <div className="apyList">
            {protocols.map((protocol) => (
              <div key={protocol.key} className="apyRow">
                <span>{protocol.name}</span>
                <strong>{data.marketData[`${protocol.key}_apy`]}%</strong>
              </div>
            ))}
          </div>
          <p className="muted">Captured {formatDate(data.marketData.timestamp)}</p>
        </article>
      </section>

      <section className="panel">
        <div className="panelHeader">
          <div>
            <p className="sectionKicker">Rebalanced allocation</p>
            <h2>Delta check against already allocated funds</h2>
          </div>
          <StatusPill tone={totalDelta === 0 ? "blue" : "amber"}>
            {totalDelta === 0 ? "Hold position" : "Movement required"}
          </StatusPill>
        </div>
        <AllocationBar rows={rebalanceRows} />
        <div className="tableWrap">
          <table>
            <thead>
              <tr>
                <th>Protocol</th>
                <th>Previous</th>
                <th>Target</th>
                <th>Delta</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {data.rebalance.deltas.map((item) => (
                <tr key={item.protocol}>
                  <td className="protocolCell">{protocols.find((p) => p.key === item.protocol)?.name}</td>
                  <td>{item.previousPct}% · {formatUsdc(item.previousAmountUsdc)}</td>
                  <td>{item.targetPct}% · {formatUsdc(item.targetAmountUsdc)}</td>
                  <td className={item.deltaUsdc === 0 ? "neutralDelta" : item.deltaUsdc > 0 ? "positiveDelta" : "negativeDelta"}>
                    {item.deltaUsdc > 0 ? "+" : ""}{formatUsdc(item.deltaUsdc)}
                  </td>
                  <td><StatusPill tone={item.action === "hold" ? "blue" : "amber"}>{item.action}</StatusPill></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="detailStrip">
          <div>
            <span>Timestamp</span>
            <strong>{formatDate(data.rebalance.timestamp)}</strong>
          </div>
          <div>
            <span>KeeperHub execution</span>
            <strong>{data.rebalance.executionId}</strong>
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panelHeader">
          <div>
            <p className="sectionKicker">Rebalance history</p>
            <h2>How market changes moved the 1 USDC pool</h2>
          </div>
          <StatusPill tone="green">{rebalanceHistory.length} KeeperHub executions</StatusPill>
        </div>
        <div className="historyGrid">
          <div className="apyChart">
            {history.map((item, index) => (
              <div className="apyChartRow" key={item.executionId}>
                <div className="chartLabel">
                  <span>{index + 1}</span>
                  <strong>{item.label}</strong>
                </div>
                <div className="chartTrack">
                  <div
                    className="chartFill"
                    style={{ width: `${Math.max(8, (item.expectedApy / bestApy) * 100)}%` }}
                  />
                </div>
                <div className="chartValue">
                  <strong>{item.expectedApy.toFixed(2)}%</strong>
                  {item.expectedApyLift > 0 && <span>+{item.expectedApyLift.toFixed(2)}</span>}
                </div>
              </div>
            ))}
          </div>
          <div className="profitExplain">
            <span>Estimated yield improvement</span>
            <strong>+{totalApyLift.toFixed(2)} percentage points</strong>
            <p>
              This compares the old allocation against the new allocation using the APYs at each
              rebalance. It shows expected annual yield lift, not realized profit.
            </p>
          </div>
        </div>
        <div className="timeline">
          {history.map((item) => (
            <article className="timelineItem" key={item.executionId}>
              <div className="timelineTop">
                <div>
                  <h3>{item.label}</h3>
                  <p>{formatDate(item.timestamp)}</p>
                </div>
                <StatusPill tone={item.type === "fresh" ? "green" : "blue"}>
                  {item.type === "fresh" ? "Fresh allocation" : "Rebalance"}
                </StatusPill>
              </div>
              <AllocationBar rows={allocationRows(item.allocation, item.amounts ?? amountsFromAllocation(item.allocation))} />
              <p className="timelineSummary">{item.summary}</p>
              {item.deltas && (
                <div className="miniDeltaGrid">
                  {item.deltas.map((delta) => (
                    <div className="miniDelta" key={`${item.executionId}-${delta.protocol}`}>
                      <span>{protocols.find((p) => p.key === delta.protocol)?.name}</span>
                      <strong className={delta.deltaUsdc > 0 ? "positiveDelta" : delta.deltaUsdc < 0 ? "negativeDelta" : "neutralDelta"}>
                        {delta.action} {delta.deltaUsdc !== 0 ? formatUsdc(Math.abs(delta.deltaUsdc)) : ""}
                      </strong>
                      <small>{delta.previousPct}% to {delta.targetPct}%</small>
                    </div>
                  ))}
                </div>
              )}
              <div className="executionLine">
                <span>KeeperHub execution</span>
                <strong>{item.executionId}</strong>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="panel">
        <div className="panelHeader">
          <div>
            <p className="sectionKicker">Transaction hashes</p>
            <h2>Fresh allocation transfers</h2>
          </div>
        </div>
        <div className="txGrid">
          {data.freshAllocation.transactions.map((tx) => (
            <div className="txCard" key={tx.hash}>
              <div className="txTopline">
                <strong>{tx.label}</strong>
                <StatusPill>{tx.status}</StatusPill>
              </div>
              <div className="txAmount">{formatUsdc(tx.amountUsdc)}</div>
              <HashLink tx={tx} />
            </div>
          ))}
        </div>
      </section>

      <section className="notes">
        {data.notes.map((note) => (
          <p key={note}>{note}</p>
        ))}
      </section>
    </main>
  );
}
