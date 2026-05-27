import { Navigate, Route, Routes } from 'react-router-dom';
import { CommandCenter } from './pages/CommandCenter';
import { PipelineFunnel } from './pages/PipelineFunnel';
import { ValidatedProducts } from './pages/ValidatedProducts';
import { RejectedProducts } from './pages/RejectedProducts';
import { CompetitionReview } from './pages/CompetitionReview';
import { ShippingReview } from './pages/ShippingReview';
import { ExportCenter } from './pages/ExportCenter';
import { ManualQA } from './pages/ManualQA';
import { AgentLogs } from './pages/AgentLogs';
import { DiscoveryAgents } from './pages/DiscoveryAgents';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<CommandCenter />} />
      <Route path="/funnel" element={<PipelineFunnel />} />
      <Route path="/validated" element={<ValidatedProducts />} />
      <Route path="/rejected" element={<RejectedProducts />} />
      <Route path="/competition" element={<CompetitionReview />} />
      <Route path="/shipping" element={<ShippingReview />} />
      <Route path="/exports" element={<ExportCenter />} />
      <Route path="/manual-qa" element={<ManualQA />} />
      <Route path="/agent-logs" element={<AgentLogs />} />
      <Route path="/discovery-agents" element={<DiscoveryAgents />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
