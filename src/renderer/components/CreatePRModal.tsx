import React, { useState, useEffect } from 'react';
import { X, GitPullRequest, Loader2, AlertCircle, ChevronRight, CheckCircle2 } from 'lucide-react';
import type { Task, Project } from '../../shared/types';

interface CreatePRModalProps {
  task: Task;
  project: Project;
  onClose: () => void;
}

interface Commit {
  hash: string;
  subject: string;
  authorName: string;
  authorDate: number;
}

export function CreatePRModal({ task, project, onClose }: CreatePRModalProps) {
  const [title, setTitle] = useState(task.name);
  const [description, setDescription] = useState('');
  const [baseBranch, setBaseBranch] = useState('main');
  const [commits, setCommits] = useState<Commit[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadPRData() {
      try {
        setLoading(true);
        // Get default branch
        const branchRes = await window.electronAPI.githubGetDefaultBranch(task.path);
        if (branchRes.success) {
          setBaseBranch(branchRes.data);
        }

        // Get commits
        const commitsRes = await window.electronAPI.githubGetPrCommits(
          task.path,
          branchRes.data || 'main',
          task.branch
        );
        if (commitsRes.success) {
          setCommits(commitsRes.data);
        } else {
          setError(commitsRes.error || 'Failed to load commits');
        }

        // Generate description
        let desc = '';
        if (task.linkedIssues && task.linkedIssues.length > 0) {
          desc += task.linkedIssues.map((num) => `Closes #${num}`).join('\n') + '\n\n';
        }
        setDescription(desc);

      } catch (err) {
        setError(String(err));
      } finally {
        setLoading(false);
      }
    }

    loadPRData();
  }, [task.path, task.branch, task.name, task.linkedIssues]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const res = await window.electronAPI.githubCreatePr({
        cwd: task.path,
        title,
        body: description,
        base: baseBranch,
      });

      if (res.success) {
        window.electronAPI.openExternal(res.data);
        onClose();
      } else {
        setError(res.error || 'Failed to create pull request');
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center modal-backdrop animate-fade-in"
      onClick={onClose}
    >
      <div
        className="bg-card border border-border/60 rounded-xl shadow-2xl shadow-black/40 w-[500px] max-h-[85vh] flex flex-col animate-slide-up overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 h-12 border-b border-border/60 flex-shrink-0"
          style={{ background: 'hsl(var(--surface-2))' }}
        >
          <div className="flex items-center gap-2">
            <GitPullRequest size={14} className="text-primary" />
            <h2 className="text-[14px] font-semibold text-foreground">Create Pull Request</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-accent text-muted-foreground/50 hover:text-foreground transition-all duration-150"
          >
            <X size={14} strokeWidth={2} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 custom-scrollbar">
          {loading ? (
            <div className="py-20 flex flex-col items-center justify-center text-muted-foreground/50">
              <Loader2 size={24} className="animate-spin mb-3" strokeWidth={1.5} />
              <p className="text-[13px]">Preparing pull request...</p>
            </div>
          ) : (
            <form id="create-pr-form" onSubmit={handleSubmit} className="space-y-5">
              {error && (
                <div className="px-3 py-2 rounded-lg bg-destructive/10 border border-destructive/20 flex gap-2 text-destructive animate-in fade-in slide-in-from-top-1">
                  <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
                  <p className="text-[12px] leading-relaxed">{error}</p>
                </div>
              )}

              <div>
                <label className="block text-[12px] font-medium text-muted-foreground/70 mb-1.5">
                  Title
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-background border border-input/60 text-foreground text-[13px] focus:outline-none focus:ring-2 focus:ring-ring/30 focus:border-ring/50 transition-all duration-150"
                  placeholder="PR Title"
                  required
                  autoFocus
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[12px] font-medium text-muted-foreground/70 mb-1.5">
                    Base Branch
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      value={baseBranch}
                      onChange={(e) => setBaseBranch(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg bg-background border border-input/60 text-foreground text-[13px] focus:outline-none focus:ring-2 focus:ring-ring/30 focus:border-ring/50 transition-all duration-150"
                      placeholder="main"
                      required
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-[12px] font-medium text-muted-foreground/70 mb-1.5">
                    Head Branch
                  </label>
                  <div className="px-3 py-2 rounded-lg bg-accent/30 border border-border/40 text-muted-foreground/70 text-[13px] font-mono truncate">
                    {task.branch}
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-[12px] font-medium text-muted-foreground/70 mb-1.5">
                  Description
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-background border border-input/60 text-foreground text-[13px] min-h-[100px] resize-none focus:outline-none focus:ring-2 focus:ring-ring/30 focus:border-ring/50 transition-all duration-150"
                  placeholder="Pull request description..."
                />
              </div>

              {commits.length > 0 && (
                <div>
                  <label className="block text-[12px] font-medium text-muted-foreground/70 mb-2">
                    Commits ({commits.length})
                  </label>
                  <div className="rounded-lg border border-border/60 overflow-hidden divide-y divide-border/40 bg-surface-1">
                    {commits.map((commit) => (
                      <div key={commit.hash} className="px-3 py-2 flex items-start gap-2.5">
                        <CheckCircle2 size={12} className="text-green-500/60 mt-0.5 flex-shrink-0" />
                        <div className="min-w-0">
                          <div className="text-[12px] text-foreground font-medium truncate leading-tight">
                            {commit.subject}
                          </div>
                          <div className="text-[10px] text-muted-foreground/50 mt-0.5 flex items-center gap-1.5 font-mono">
                            <span>{commit.hash.substring(0, 7)}</span>
                            <span>•</span>
                            <span className="truncate">{commit.authorName}</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </form>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-border/60 bg-surface-2 flex items-center justify-between flex-shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-[13px] font-medium text-muted-foreground/70 hover:text-foreground hover:bg-accent transition-all duration-150"
          >
            Cancel
          </button>
          <button
            form="create-pr-form"
            type="submit"
            disabled={loading || submitting}
            className="flex items-center gap-2 px-5 py-2 rounded-lg text-[13px] font-medium bg-primary text-primary-foreground hover:brightness-110 disabled:opacity-30 disabled:cursor-not-allowed transition-all duration-150 shadow-lg shadow-primary/20"
          >
            {submitting ? (
              <>
                <Loader2 size={14} className="animate-spin" strokeWidth={2.2} />
                <span>Creating...</span>
              </>
            ) : (
              <>
                <span>Create Pull Request</span>
                <ChevronRight size={14} strokeWidth={2.2} />
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
