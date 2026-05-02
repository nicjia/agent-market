import React, { useEffect, useState } from "react";

type Task = {
  taskId: string;
  bountyWei: string;
  state: string;
  riskTier: number;
};

type Vote = {
  juror: string;
  voteValid: boolean | null;
};

type TaskDetail = Task & {
  votes: Vote[];
};

const apiBase = import.meta.env.VITE_API_BASE || "http://localhost:3000";

async function fetchTasks(): Promise<Task[]> {
  const res = await fetch(`${apiBase}/tasks`);
  const data = await res.json();
  return data.tasks || [];
}

async function fetchTaskVotes(taskId: string): Promise<Vote[]> {
  const res = await fetch(`${apiBase}/tasks/${taskId}/votes`);
  const data = await res.json();
  return data.votes || [];
}

export function App() {
  const [tasks, setTasks] = useState<TaskDetail[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      const list = await fetchTasks();
      const details: TaskDetail[] = [];
      for (const task of list) {
        const votes = task.state === "DISPUTE_ACTIVE" || task.state === "SETTLED"
          ? await fetchTaskVotes(task.taskId)
          : [];
        details.push({ ...task, votes });
      }
      if (active) {
        setTasks(details);
        setLoading(false);
      }
    }

    load().catch(() => setLoading(false));
    const interval = setInterval(() => load().catch(() => undefined), 5000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, []);

  return (
    <div className="page">
      <header className="hero">
        <div>
          <p className="eyebrow">Agent Market</p>
          <h1>Marketplace Monitor</h1>
          <p className="subhead">Live tasks, states, and juror decisions.</p>
        </div>
        <div className="stats">
          <div>
            <span>Active Tasks</span>
            <strong>{tasks.filter((task) => task.state !== "SETTLED").length}</strong>
          </div>
          <div>
            <span>Disputes</span>
            <strong>{tasks.filter((task) => task.state === "DISPUTE_ACTIVE").length}</strong>
          </div>
        </div>
      </header>

      {loading ? (
        <div className="card">Loading tasks...</div>
      ) : (
        <div className="grid">
          {tasks.map((task) => (
            <div className="card" key={task.taskId}>
              <div className="card-head">
                <div>
                  <p className="label">Task #{task.taskId}</p>
                  <h2>{task.bountyWei} wei</h2>
                </div>
                <span className={`pill state-${task.state.toLowerCase()}`}>{task.state}</span>
              </div>
              <div className="meta">
                <span>Risk Tier {task.riskTier}</span>
              </div>
              <div className="votes">
                <p>Juror votes</p>
                {task.votes.length === 0 ? (
                  <span className="muted">No votes yet</span>
                ) : (
                  <div className="vote-grid">
                    {task.votes.map((vote) => (
                      <span
                        key={vote.juror}
                        className={`vote ${vote.voteValid ? "vote-yes" : "vote-no"}`}
                      >
                        {vote.voteValid ? "Yes" : "No"}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
