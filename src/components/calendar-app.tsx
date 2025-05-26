import React from 'react';
import { CalendarView } from './calendar-view';

interface CalendarConfig {
  title: string;
  events: Array<{
    title: string;
    start: Date | string;
    end: Date | string;
    allDay?: boolean;
    description?: string;
    location?: string;
  }>;
  calendarId: string;
}

interface CalendarAppProps {
  calendarId: string;
}

export const CalendarApp: React.FC<CalendarAppProps> = ({ calendarId }) => {
  const [config, setConfig] = React.useState<CalendarConfig | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    // Fetch calendar data
    fetch(`/api/calendar/${calendarId}/data`)
      .then(res => {
        if (!res.ok) throw new Error('Calendar not found');
        return res.json();
      })
      .then(data => {
        setConfig(data);
        setTimeout(() => setLoading(false), 500);
      })
      .catch(err => {
        setError(err.message);
        setLoading(false);
      });
  }, [calendarId]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 p-4">
        <div className="max-w-7xl mx-auto">
          <div className="rounded-lg border border-slate-200 bg-white text-slate-950 shadow-sm animate-pulse">
            <div className="bg-gradient-to-r from-blue-600 to-blue-700 text-white flex flex-col space-y-1.5 p-6">
              <div className="h-8 bg-white/20 rounded w-1/3"></div>
            </div>
            <div className="p-6 pt-0">
              <div className="h-96 bg-gray-200 rounded"></div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="rounded-lg border border-slate-200 bg-white text-slate-950 shadow-sm w-full max-w-2xl">
          <div className="p-6 pt-0 p-8">
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
              {error}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!config) return null;

  return (
    <CalendarView
      title={config.title}
      events={config.events}
      calendarId={config.calendarId}
    />
  );
};