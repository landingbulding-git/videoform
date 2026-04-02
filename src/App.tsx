/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import VideoFlow from './components/VideoFlow';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/v/:slug" element={<VideoFlow />} />
        <Route path="*" element={<Navigate to="/v/onboarding" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
