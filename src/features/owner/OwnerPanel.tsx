/**
 * Owner Panel (11-owner-panel.txt).
 *
 * A distinct administrative surface (11 s1.2): it never implies the owner
 * has a personal ledger. It reads system state and other users' metadata.
 * Every call targets /api/owner/* and is 403'd for non-OWNER sessions
 * server-side regardless of what this UI renders.
 */
import { Navigate, Route, Routes } from 'react-router-dom';
import { OwnerOverview } from './OwnerOverview';
import { OwnerUsers } from './OwnerUsers';
import { OwnerColumns } from './OwnerColumns';
import { OwnerAudit } from './OwnerAudit';
import { OwnerSystem } from './OwnerSystem';

export function OwnerPanel() {
  return (
    <Routes>
      <Route index element={<OwnerOverview />} />
      <Route path="users" element={<OwnerUsers />} />
      <Route path="columns" element={<OwnerColumns />} />
      <Route path="audit" element={<OwnerAudit />} />
      <Route path="system" element={<OwnerSystem />} />
      <Route path="*" element={<Navigate to="/owner" replace />} />
    </Routes>
  );
}
