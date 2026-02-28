import React, { useState, useEffect, useCallback } from 'react';
import { X, RefreshCw, ExternalLink, Plus, Loader2, MessageSquare, Check } from 'lucide-react';
import type { GithubIssue, GithubLabel } from '../../shared/types';

interface KanbanBoardProps {
  projectPath: string;
  projectName: string;
  onClose: () => void;
  onCreateTask: (issue: GithubIssue) => void;
}

interface Column {
  label: GithubLabel | null; // null = "No label" column
  issues: GithubIssue[];
}

// Build a hex color with sufficient contrast for label text
function labelTextColor(hex: string): string {
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.5 ? '#1a1a1a' : '#ffffff';
}

function assigneeInitials(login: string): string {
  return login.slice(0, 2).toUpperCase();
}

export function KanbanBoard({ projectPath, projectName, onClose, onCreateTask }: KanbanBoardProps) {
  const [issues, setIssues] = useState<GithubIssue[]>([]);
  const [labels, setLabels] = useState<GithubLabel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedIssue, setExpandedIssue] = useState<GithubIssue | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(() => {
    try {
      const stored = localStorage.getItem(`kanban-hidden-${projectPath}`);
      return stored ? new Set(JSON.parse(stored)) : new Set();
    } catch {
      return new Set();
    }
  });

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [issuesResp, labelsResp] = await Promise.all([
        window.electronAPI.githubListAllIssues(projectPath, 'open'),
        window.electronAPI.githubListLabels(projectPath),
      ]);
      if (!issuesResp.success) throw new Error(issuesResp.error ?? 'Failed to load issues');
      if (!labelsResp.success) throw new Error(labelsResp.error ?? 'Failed to load labels');
      setIssues(issuesResp.data ?? []);
      setLabels(labelsResp.data ?? []);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [projectPath]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Build columns: one per label, issues assigned to FIRST matching label
  const columns: Column[] = (() => {
    const labelMap = new Map<string, GithubLabel>(labels.map((l) => [l.name, l]));
    const buckets = new Map<string, GithubIssue[]>();
    const noLabel: GithubIssue[] = [];

    for (const issue of issues) {
      const firstLabel = issue.labels.find((lname) => labelMap.has(lname));
      if (firstLabel) {
        if (!buckets.has(firstLabel)) buckets.set(firstLabel, []);
        buckets.get(firstLabel)!.push(issue);
      } else {
        noLabel.push(issue);
      }
    }

    const cols: Column[] = labels
      .filter((l) => buckets.has(l.name))
      .map((l) => ({ label: l, issues: buckets.get(l.name)! }));

    if (noLabel.length > 0) {
      cols.push({ label: null, issues: noLabel });
    }

    return cols;
  })();

  function toggleColumn(name: string) {
    setHiddenColumns((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      localStorage.setItem(`kanban-hidden-${projectPath}`, JSON.stringify([...next]));
      return next;
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col"
      style={
        { background: 'hsl(var(--background))', WebkitAppRegion: 'no-drag' } as React.CSSProperties
      }
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-5 h-12 border-b border-border/50 flex-shrink-0"
        style={{ background: 'hsl(var(--surface-1))' }}
      >
        <div className="flex items-center gap-3">
          <span className="text-[13px] font-semibold text-foreground">{projectName}</span>
          <span className="text-muted-foreground/40 text-[13px]">/</span>
          <span className="text-[13px] text-muted-foreground/70">Issues</span>
          {!loading && (
            <span className="text-[11px] text-muted-foreground/40 tabular-nums">
              {issues.length} open
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              setShowCreateForm(true);
              setExpandedIssue(null);
            }}
            className="flex items-center gap-1 px-2.5 py-1 rounded-md text-[12px] font-medium bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
          >
            <Plus size={12} strokeWidth={2.5} />
            New issue
          </button>
          <button
            onClick={fetchData}
            disabled={loading}
            className="p-1.5 rounded-md hover:bg-accent/60 text-muted-foreground/50 hover:text-foreground transition-colors disabled:opacity-30"
            title="Refresh"
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} strokeWidth={2} />
          </button>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md hover:bg-accent/60 text-muted-foreground/50 hover:text-foreground transition-colors"
          >
            <X size={14} strokeWidth={2} />
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex flex-1 min-h-0">
        {/* Kanban columns */}
        <div className="flex-1 min-w-0 overflow-x-auto">
          {loading ? (
            <div className="flex items-center justify-center h-full gap-2 text-muted-foreground/40">
              <Loader2 size={16} className="animate-spin" />
              <span className="text-[13px]">Loading issues...</span>
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center h-full gap-3">
              <p className="text-[13px] text-destructive/80">{error}</p>
              <button
                onClick={fetchData}
                className="px-3 py-1.5 rounded-md text-[12px] bg-accent/60 hover:bg-accent text-foreground transition-colors"
              >
                Retry
              </button>
            </div>
          ) : columns.length === 0 ? (
            <div className="flex items-center justify-center h-full text-[13px] text-muted-foreground/40">
              No open issues found
            </div>
          ) : (
            <div className="flex gap-3 p-4 h-full items-start">
              {columns.map((col) => {
                const colKey = col.label?.name ?? '__no_label__';
                const isHidden = hiddenColumns.has(colKey);
                const labelColor = col.label ? `#${col.label.color}` : undefined;
                const textColor = col.label ? labelTextColor(col.label.color) : undefined;

                return (
                  <div
                    key={colKey}
                    className={`flex flex-col flex-shrink-0 rounded-xl border border-border/40 overflow-hidden transition-all duration-200 ${
                      isHidden ? 'w-[140px]' : 'w-[280px]'
                    }`}
                    style={{ background: 'hsl(var(--surface-1))' }}
                  >
                    {/* Column header */}
                    <button
                      onClick={() => toggleColumn(colKey)}
                      className="flex items-center justify-between px-3 py-2.5 hover:bg-accent/40 transition-colors flex-shrink-0"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        {col.label ? (
                          <span
                            className="px-2 py-0.5 rounded-full text-[11px] font-medium truncate max-w-[140px]"
                            style={{ background: labelColor, color: textColor }}
                          >
                            {col.label.name}
                          </span>
                        ) : (
                          <span className="text-[12px] text-muted-foreground/60 font-medium">
                            No label
                          </span>
                        )}
                      </div>
                      <span className="text-[11px] text-muted-foreground/40 tabular-nums flex-shrink-0 ml-2">
                        {col.issues.length}
                      </span>
                    </button>

                    {/* Issues */}
                    {!isHidden && (
                      <div className="flex-1 overflow-y-auto p-2 space-y-1.5 max-h-[calc(100vh-130px)]">
                        {col.issues.map((issue) => (
                          <IssueCard
                            key={issue.number}
                            issue={issue}
                            labelMap={new Map(labels.map((l) => [l.name, l]))}
                            isExpanded={expandedIssue?.number === issue.number}
                            onClick={() =>
                              setExpandedIssue(
                                expandedIssue?.number === issue.number ? null : issue,
                              )
                            }
                          />
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Create issue form */}
        {showCreateForm && (
          <CreateIssueForm
            projectPath={projectPath}
            labels={labels}
            onClose={() => setShowCreateForm(false)}
            onCreated={(issue) => {
              setIssues((prev) => [issue, ...prev]);
              setShowCreateForm(false);
              setExpandedIssue(issue);
            }}
          />
        )}

        {/* Issue detail panel */}
        {!showCreateForm && expandedIssue && (
          <IssueDetailPanel
            issue={expandedIssue}
            labelMap={new Map(labels.map((l) => [l.name, l]))}
            onClose={() => setExpandedIssue(null)}
            onCreateTask={() => {
              onCreateTask(expandedIssue);
              setExpandedIssue(null);
            }}
          />
        )}
      </div>
    </div>
  );
}

// ── Issue Card ────────────────────────────────────────────────

interface IssueCardProps {
  issue: GithubIssue;
  labelMap: Map<string, GithubLabel>;
  isExpanded: boolean;
  onClick: () => void;
}

function IssueCard({ issue, labelMap, isExpanded, onClick }: IssueCardProps) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left p-3 rounded-lg border transition-all duration-150 ${
        isExpanded
          ? 'border-primary/40 bg-primary/5'
          : 'border-border/30 bg-background/60 hover:border-border/60 hover:bg-accent/20'
      }`}
    >
      <div className="flex items-start gap-2">
        <span className="text-[10px] text-muted-foreground/40 font-mono flex-shrink-0 mt-0.5">
          #{issue.number}
        </span>
        <span className="text-[12px] text-foreground/85 leading-snug flex-1 min-w-0">
          {issue.title}
        </span>
      </div>

      {/* Label badges (skip the column label, show others) */}
      {issue.labels.length > 1 && (
        <div className="flex flex-wrap gap-1 mt-1.5 ml-6">
          {issue.labels.slice(1, 4).map((lname) => {
            const label = labelMap.get(lname);
            if (!label) return null;
            return (
              <span
                key={lname}
                className="px-1.5 py-0.5 rounded-full text-[9px] font-medium"
                style={{
                  background: `#${label.color}`,
                  color: labelTextColor(label.color),
                }}
              >
                {label.name}
              </span>
            );
          })}
        </div>
      )}

      {/* Footer: assignees + comments */}
      {((issue.assignees && issue.assignees.length > 0) || (issue.comments ?? 0) > 0) && (
        <div className="flex items-center justify-between mt-2 ml-6">
          <div className="flex items-center gap-1">
            {issue.assignees?.slice(0, 3).map((login) => (
              <span
                key={login}
                className="w-5 h-5 rounded-full bg-accent flex items-center justify-center text-[8px] font-medium text-muted-foreground"
                title={login}
              >
                {assigneeInitials(login)}
              </span>
            ))}
          </div>
          {(issue.comments ?? 0) > 0 && (
            <div className="flex items-center gap-0.5 text-muted-foreground/40">
              <MessageSquare size={9} strokeWidth={2} />
              <span className="text-[10px]">{issue.comments}</span>
            </div>
          )}
        </div>
      )}
    </button>
  );
}

// ── Issue Detail Panel ────────────────────────────────────────

interface IssueDetailPanelProps {
  issue: GithubIssue;
  labelMap: Map<string, GithubLabel>;
  onClose: () => void;
  onCreateTask: () => void;
}

function IssueDetailPanel({ issue, labelMap, onClose, onCreateTask }: IssueDetailPanelProps) {
  return (
    <div
      className="w-[380px] flex-shrink-0 border-l border-border/40 flex flex-col"
      style={{ background: 'hsl(var(--surface-1))' }}
    >
      {/* Panel header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/40 flex-shrink-0">
        <span className="text-[11px] text-muted-foreground/50 font-mono">#{issue.number}</span>
        <button
          onClick={onClose}
          className="p-1 rounded hover:bg-accent/60 text-muted-foreground/40 hover:text-foreground transition-colors"
        >
          <X size={13} strokeWidth={2} />
        </button>
      </div>

      {/* Panel body */}
      <div className="flex-1 overflow-y-auto p-4">
        <h2 className="text-[14px] font-semibold text-foreground leading-snug mb-3">
          {issue.title}
        </h2>

        {/* Labels */}
        {issue.labels.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-4">
            {issue.labels.map((lname) => {
              const label = labelMap.get(lname);
              if (!label) {
                return (
                  <span
                    key={lname}
                    className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-accent/60 text-muted-foreground"
                  >
                    {lname}
                  </span>
                );
              }
              return (
                <span
                  key={lname}
                  className="px-2 py-0.5 rounded-full text-[10px] font-medium"
                  style={{
                    background: `#${label.color}`,
                    color: labelTextColor(label.color),
                  }}
                >
                  {lname}
                </span>
              );
            })}
          </div>
        )}

        {/* Assignees */}
        {issue.assignees && issue.assignees.length > 0 && (
          <div className="mb-4">
            <p className="text-[11px] text-muted-foreground/50 mb-1.5">Assignees</p>
            <div className="flex flex-wrap gap-2">
              {issue.assignees.map((login) => (
                <div key={login} className="flex items-center gap-1.5">
                  <span className="w-5 h-5 rounded-full bg-accent flex items-center justify-center text-[8px] font-medium text-muted-foreground">
                    {assigneeInitials(login)}
                  </span>
                  <span className="text-[12px] text-foreground/70">{login}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Milestone */}
        {issue.milestone && (
          <div className="mb-4">
            <p className="text-[11px] text-muted-foreground/50 mb-1">Milestone</p>
            <span className="text-[12px] text-foreground/70">{issue.milestone.title}</span>
          </div>
        )}

        {/* Body */}
        {issue.body && (
          <div className="mt-2">
            <p className="text-[11px] text-muted-foreground/50 mb-2">Description</p>
            <pre className="text-[12px] text-foreground/70 whitespace-pre-wrap font-sans leading-relaxed">
              {issue.body.length > 3000 ? issue.body.slice(0, 3000) + '\n...' : issue.body}
            </pre>
          </div>
        )}
      </div>

      {/* Panel footer */}
      <div className="px-4 py-3 border-t border-border/40 flex gap-2 flex-shrink-0">
        <button
          onClick={onCreateTask}
          className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-medium bg-primary text-primary-foreground hover:brightness-110 transition-all"
        >
          <Plus size={13} strokeWidth={2.5} />
          Start Task
        </button>
        <button
          onClick={() => window.electronAPI.openExternal(issue.url)}
          className="px-3 py-2 rounded-lg text-[12px] text-muted-foreground/70 hover:text-foreground hover:bg-accent/60 transition-colors flex items-center gap-1"
          title="Open in GitHub"
        >
          <ExternalLink size={12} strokeWidth={2} />
        </button>
      </div>
    </div>
  );
}

// ── Create Issue Form ─────────────────────────────────────────

interface CreateIssueFormProps {
  projectPath: string;
  labels: GithubLabel[];
  onClose: () => void;
  onCreated: (issue: GithubIssue) => void;
}

function CreateIssueForm({ projectPath, labels, onClose, onCreated }: CreateIssueFormProps) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [selectedLabels, setSelectedLabels] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleLabel(name: string) {
    setSelectedLabels((prev) =>
      prev.includes(name) ? prev.filter((l) => l !== name) : [...prev, name],
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const resp = await window.electronAPI.githubCreateIssue({
        cwd: projectPath,
        title: title.trim(),
        body: body.trim() || undefined,
        labels: selectedLabels.length > 0 ? selectedLabels : undefined,
      });
      if (!resp.success || !resp.data) throw new Error(resp.error ?? 'Failed to create issue');
      onCreated(resp.data);
    } catch (err) {
      setError(String(err));
      setSaving(false);
    }
  }

  return (
    <div
      className="w-[380px] flex-shrink-0 border-l border-border/40 flex flex-col"
      style={{ background: 'hsl(var(--surface-1))' }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/40 flex-shrink-0">
        <span className="text-[13px] font-semibold text-foreground">New issue</span>
        <button
          onClick={onClose}
          className="p-1 rounded hover:bg-accent/60 text-muted-foreground/40 hover:text-foreground transition-colors"
        >
          <X size={13} strokeWidth={2} />
        </button>
      </div>

      {/* Form */}
      <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Title */}
          <div>
            <label className="block text-[11px] text-muted-foreground/50 mb-1.5">
              Title <span className="text-destructive/70">*</span>
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Issue title..."
              autoFocus
              className="w-full px-3 py-2 rounded-lg bg-background border border-input/60 text-foreground text-[13px] placeholder:text-muted-foreground/30 focus:outline-none focus:ring-2 focus:ring-ring/30 focus:border-ring/50 transition-all"
            />
          </div>

          {/* Body */}
          <div>
            <label className="block text-[11px] text-muted-foreground/50 mb-1.5">
              Description <span className="text-muted-foreground/30 font-normal">optional</span>
            </label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Describe the issue..."
              rows={5}
              className="w-full px-3 py-2 rounded-lg bg-background border border-input/60 text-foreground text-[13px] placeholder:text-muted-foreground/30 focus:outline-none focus:ring-2 focus:ring-ring/30 focus:border-ring/50 transition-all resize-none"
            />
          </div>

          {/* Labels */}
          {labels.length > 0 && (
            <div>
              <label className="block text-[11px] text-muted-foreground/50 mb-1.5">
                Labels <span className="text-muted-foreground/30 font-normal">optional</span>
              </label>
              <div className="flex flex-wrap gap-1.5">
                {labels.map((label) => {
                  const isSelected = selectedLabels.includes(label.name);
                  return (
                    <button
                      key={label.name}
                      type="button"
                      onClick={() => toggleLabel(label.name)}
                      className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium transition-all border ${
                        isSelected
                          ? 'border-transparent'
                          : 'border-transparent opacity-50 hover:opacity-80'
                      }`}
                      style={
                        isSelected
                          ? {
                              background: `#${label.color}`,
                              color: labelTextColor(label.color),
                            }
                          : {
                              background: `#${label.color}30`,
                              color: `#${label.color}`,
                            }
                      }
                    >
                      {isSelected && <Check size={9} strokeWidth={3} />}
                      {label.name}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {error && (
            <p className="text-[11px] text-destructive/80 bg-destructive/10 px-3 py-2 rounded-lg">
              {error}
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-border/40 flex gap-2 flex-shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-2 rounded-lg text-[12px] text-muted-foreground/60 hover:text-foreground hover:bg-accent/60 transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!title.trim() || saving}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-medium bg-primary text-primary-foreground hover:brightness-110 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
          >
            {saving ? (
              <>
                <Loader2 size={12} className="animate-spin" />
                Creating...
              </>
            ) : (
              <>
                <Plus size={12} strokeWidth={2.5} />
                Create issue
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
