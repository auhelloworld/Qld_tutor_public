'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
  parentQuestsDeleteCatalog,
  parentQuestsResolve,
  parentQuestsSaveCatalog,
  parentQuestsSettings,
  parentQuestsSnapshot,
} from '../../lib/api';
import { showToast } from '../../lib/toast';

type CatalogItem = {
  id: string;
  title: string;
  emoji: string;
  cost_stars: number;
  category: string;
  stock?: number | null;
  enabled?: boolean;
  sort?: number;
  description?: string;
};

type Redemption = {
  id: string;
  catalog_id?: string;
  title?: string;
  emoji?: string;
  cost_stars?: number;
  quantity?: number;
  unit_cost?: number;
  status?: string;
  created_at?: string;
  resolved_at?: string;
  parent_note?: string;
  auto?: boolean;
};

type Snapshot = {
  enabled: boolean;
  shop_enabled: boolean;
  chests_enabled: boolean;
  spin_enabled: boolean;
  daily_star_cap: number;
  stars: number;
  level: number;
  title: string;
  xp: number;
  chests: number;
  freeze_tokens: number;
  catalog: CatalogItem[];
  pending: Redemption[];
  recent_redemptions: Redemption[];
  ledger: Array<{ id: string; delta: number; reason: string; at?: string }>;
};

const emptyForm = {
  id: '',
  title: '',
  emoji: '🎁',
  cost_stars: 40,
  category: 'privilege',
  stock: '' as string | number,
  enabled: true,
  description: '',
};

export default function ParentQuestsPanel() {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState(emptyForm);
  const [editing, setEditing] = useState(false);

  const reload = useCallback(async () => {
    setError('');
    try {
      const data = await parentQuestsSnapshot();
      setSnap(data as Snapshot);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load quests admin');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const patchSettings = async (patch: Partial<{
    enabled: boolean;
    shop_enabled: boolean;
    chests_enabled: boolean;
    spin_enabled: boolean;
    daily_star_cap: number;
  }>) => {
    setBusy(true);
    try {
      const data = await parentQuestsSettings(patch);
      setSnap(data as Snapshot);
      showToast('Settings saved', 'success');
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Save failed', 'error');
    } finally {
      setBusy(false);
    }
  };

  const resolve = async (id: string, approve: boolean) => {
    setBusy(true);
    try {
      await parentQuestsResolve(id, approve);
      showToast(approve ? 'Approved — please fulfil the reward' : 'Rejected — stars refunded', 'success');
      await reload();
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Resolve failed', 'error');
    } finally {
      setBusy(false);
    }
  };

  const saveItem = async () => {
    if (!form.title.trim()) {
      showToast('Title required', 'error');
      return;
    }
    setBusy(true);
    try {
      const stockRaw = String(form.stock).trim();
      await parentQuestsSaveCatalog({
        id: form.id || undefined,
        title: form.title.trim(),
        emoji: form.emoji || '🎁',
        cost_stars: Number(form.cost_stars) || 40,
        category: form.category,
        stock: stockRaw === '' ? null : Number(stockRaw),
        enabled: form.enabled,
        description: form.description,
      });
      showToast('Catalog item saved', 'success');
      setEditing(false);
      setForm(emptyForm);
      await reload();
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Save item failed', 'error');
    } finally {
      setBusy(false);
    }
  };

  const deleteItem = async (id: string) => {
    if (!window.confirm(`Delete reward ${id}?`)) return;
    setBusy(true);
    try {
      await parentQuestsDeleteCatalog(id);
      showToast('Deleted', 'success');
      await reload();
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Delete failed', 'error');
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div role="status" aria-live="polite" className="glass-panel" style={{ padding: 20, marginTop: 16 }}>
        Loading Quests & Rewards…
      </div>
    );
  }

  if (error || !snap) {
    return (
      <div role="alert" className="glass-panel" style={{ padding: 20, marginTop: 16, color: '#b91c1c' }}>
        {error || 'Unavailable'}
        <button type="button" onClick={() => { setLoading(true); void reload(); }} style={{ marginLeft: 12 }}>
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="glass-panel" style={{ padding: 20, marginTop: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>⚔️ Quests & Rewards</h2>
          <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--text-secondary)' }}>
            Game incentives for the active student. Approve redemptions before giving real rewards.
          </p>
        </div>
        <div style={{ fontSize: 14, fontWeight: 700 }}>
          ⭐ {snap.stars} · Lv.{snap.level} {snap.title} · 🔥 boxes {snap.chests}
        </div>
      </div>

      {/* Settings */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, marginBottom: 18, alignItems: 'center' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={snap.enabled}
            disabled={busy}
            onChange={(e) => void patchSettings({ enabled: e.target.checked })}
          />
          Game on
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={snap.shop_enabled}
            disabled={busy}
            onChange={(e) => void patchSettings({ shop_enabled: e.target.checked })}
          />
          Shop on
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={snap.chests_enabled}
            disabled={busy}
            onChange={(e) => void patchSettings({ chests_enabled: e.target.checked })}
          />
          Chests on
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={snap.spin_enabled}
            disabled={busy}
            onChange={(e) => void patchSettings({ spin_enabled: e.target.checked })}
          />
          Spin wheel on
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
          Daily ⭐ cap
          <input
            type="number"
            min={20}
            max={500}
            value={snap.daily_star_cap}
            disabled={busy}
            onChange={(e) => {
              const n = Number(e.target.value);
              setSnap((s) => (s ? { ...s, daily_star_cap: Number.isFinite(n) ? n : 300 } : s));
            }}
            // Read from input on blur — avoid stale React state if blur races setState
            onBlur={(e) => {
              const n = Number(e.target.value);
              const cap = Number.isFinite(n) ? Math.min(500, Math.max(20, Math.round(n))) : 300;
              setSnap((s) => (s ? { ...s, daily_star_cap: cap } : s));
              void patchSettings({ daily_star_cap: cap });
            }}
            style={{
              width: 72,
              padding: '4px 8px',
              borderRadius: 6,
              border: '1px solid var(--border-color)',
              background: 'var(--bg-secondary)',
              color: 'var(--text-primary)',
            }}
          />
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>(saved on blur)</span>
        </label>
      </div>

      {/* Pending */}
      <h3 style={{ fontSize: 15, fontWeight: 800, margin: '0 0 10px' }}>
        Pending approvals ({snap.pending.length})
      </h3>
      {snap.pending.length === 0 ? (
        <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 16px' }}>No pending redemptions.</p>
      ) : (
        <ul style={{ listStyle: 'none', margin: '0 0 16px', padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {snap.pending.map((r) => (
            <li
              key={r.id}
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: 10,
                alignItems: 'center',
                padding: '10px 12px',
                borderRadius: 10,
                border: '1px solid rgba(245,158,11,0.35)',
                background: 'rgba(245,158,11,0.08)',
              }}
            >
              <span style={{ fontSize: 22 }}>{r.emoji || '🎁'}</span>
              <div style={{ flex: '1 1 160px' }}>
                <div style={{ fontWeight: 700 }}>{r.title}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  {r.cost_stars}⭐
                  {(r.quantity ?? 1) > 1 ? ` · qty ${r.quantity}` : ''}
                  {' · '}
                  {r.created_at || ''}
                </div>
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={() => void resolve(r.id, true)}
                style={{
                  padding: '6px 12px',
                  borderRadius: 8,
                  border: 'none',
                  background: '#16a34a',
                  color: '#fff',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                ✓ Approve
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void resolve(r.id, false)}
                style={{
                  padding: '6px 12px',
                  borderRadius: 8,
                  border: '1px solid var(--border-color)',
                  background: 'transparent',
                  color: 'var(--text-primary)',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                ✗ Reject
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Catalog */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <h3 style={{ fontSize: 15, fontWeight: 800, margin: 0 }}>Reward catalog</h3>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setForm(emptyForm);
            setEditing(true);
          }}
          style={{
            padding: '6px 12px',
            borderRadius: 8,
            border: 'none',
            background: 'var(--accent-color)',
            color: '#fff',
            fontWeight: 700,
            fontSize: 12,
            cursor: 'pointer',
          }}
        >
          + Add reward
        </button>
      </div>

      {editing && (
        <div
          style={{
            marginBottom: 14,
            padding: 14,
            borderRadius: 12,
            border: '1px solid var(--border-color)',
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
            gap: 10,
          }}
        >
          <label style={labStyle}>
            Emoji
            <input value={form.emoji} onChange={(e) => setForm((f) => ({ ...f, emoji: e.target.value }))} style={inpStyle} />
          </label>
          <label style={{ ...labStyle, gridColumn: 'span 2' }}>
            Title
            <input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} style={inpStyle} />
          </label>
          <label style={labStyle}>
            Cost ⭐
            <input
              type="number"
              value={form.cost_stars}
              onChange={(e) => setForm((f) => ({ ...f, cost_stars: Number(e.target.value) || 0 }))}
              style={inpStyle}
            />
          </label>
          <label style={labStyle}>
            Category
            <select
              value={form.category}
              onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
              style={inpStyle}
            >
              {['screen_time', 'cash', 'food', 'privilege', 'item'].map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </label>
          <label style={labStyle}>
            Stock (empty=∞)
            <input
              value={form.stock}
              onChange={(e) => setForm((f) => ({ ...f, stock: e.target.value }))}
              style={inpStyle}
              placeholder="∞"
            />
          </label>
          <label style={{ ...labStyle, gridColumn: '1 / -1' }}>
            Description
            <input
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              style={inpStyle}
            />
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(e) => setForm((f) => ({ ...f, enabled: e.target.checked }))}
            />
            Enabled
          </label>
          <div style={{ display: 'flex', gap: 8, gridColumn: '1 / -1' }}>
            <button type="button" disabled={busy} onClick={() => void saveItem()} style={btnPrimary}>
              Save item
            </button>
            <button type="button" onClick={() => { setEditing(false); setForm(emptyForm); }} style={btnGhost}>
              Cancel
            </button>
          </div>
        </div>
      )}

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ textAlign: 'left', color: 'var(--text-muted)' }}>
              <th style={th}> </th>
              <th style={th}>Title</th>
              <th style={th}>Cost</th>
              <th style={th}>Stock</th>
              <th style={th}>On</th>
              <th style={th}> </th>
            </tr>
          </thead>
          <tbody>
            {(snap.catalog || []).map((c) => (
              <tr key={c.id} style={{ borderTop: '1px solid var(--border-color)' }}>
                <td style={td}>{c.emoji}</td>
                <td style={td}>
                  <div style={{ fontWeight: 700 }}>{c.title}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{c.id} · {c.category}</div>
                </td>
                <td style={td}>{c.cost_stars}⭐</td>
                <td style={td}>{c.stock == null ? '∞' : c.stock}</td>
                <td style={td}>{c.enabled === false ? 'no' : 'yes'}</td>
                <td style={td}>
                  <button
                    type="button"
                    style={btnGhost}
                    onClick={() => {
                      setForm({
                        id: c.id,
                        title: c.title,
                        emoji: c.emoji,
                        cost_stars: c.cost_stars,
                        category: c.category,
                        stock: c.stock == null ? '' : c.stock,
                        enabled: c.enabled !== false,
                        description: c.description || '',
                      });
                      setEditing(true);
                    }}
                  >
                    Edit
                  </button>
                  <button type="button" style={{ ...btnGhost, marginLeft: 6 }} onClick={() => void deleteItem(c.id)}>
                    Del
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Recent ledger */}
      <h3 style={{ fontSize: 15, fontWeight: 800, margin: '18px 0 8px' }}>Recent star activity</h3>
      <ul style={{ margin: 0, padding: 0, listStyle: 'none', maxHeight: 180, overflowY: 'auto' }}>
        {(snap.ledger || []).slice(0, 15).map((row) => (
          <li
            key={row.id}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: 12,
              padding: '4px 0',
              borderBottom: '1px solid var(--border-color)',
            }}
          >
            <span style={{ color: 'var(--text-secondary)' }}>{row.reason}</span>
            <span style={{ fontWeight: 700, color: row.delta >= 0 ? '#16a34a' : '#dc2626' }}>
              {row.delta >= 0 ? '+' : ''}{row.delta}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const labStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, fontWeight: 600 };
const inpStyle: React.CSSProperties = {
  padding: '6px 8px',
  borderRadius: 6,
  border: '1px solid var(--border-color)',
  background: 'var(--bg-secondary)',
  color: 'var(--text-primary)',
  fontWeight: 500,
};
const th: React.CSSProperties = { padding: '6px 8px', fontWeight: 700 };
const td: React.CSSProperties = { padding: '8px' };
const btnPrimary: React.CSSProperties = {
  padding: '8px 14px',
  borderRadius: 8,
  border: 'none',
  background: 'var(--accent-color)',
  color: '#fff',
  fontWeight: 700,
  cursor: 'pointer',
};
const btnGhost: React.CSSProperties = {
  padding: '6px 10px',
  borderRadius: 8,
  border: '1px solid var(--border-color)',
  background: 'transparent',
  color: 'var(--text-primary)',
  fontWeight: 600,
  cursor: 'pointer',
  fontSize: 12,
};
