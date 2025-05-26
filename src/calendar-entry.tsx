import React from 'react';
import { createRoot } from 'react-dom/client';
import { CalendarApp } from './components/calendar-app';

// Get calendar ID from URL path
const pathParts = window.location.pathname.split('/');
const calendarId = pathParts[pathParts.length - 1];

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(<CalendarApp calendarId={calendarId} />);
}