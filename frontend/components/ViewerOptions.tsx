'use client';

import { useState } from 'react';

export interface ViewerOptionsState {
  showFixedAxes: boolean;
  showMovingAxes: boolean;
}

interface ViewerOptionsProps {
  options: ViewerOptionsState;
  onChange: (options: ViewerOptionsState) => void;
}

export default function ViewerOptions({ options, onChange }: ViewerOptionsProps) {
  const [isExpanded, setIsExpanded] = useState(true);

  const handleToggle = (key: keyof ViewerOptionsState) => {
    onChange({
      ...options,
      [key]: !options[key],
    });
  };

  return (
    <div className="p-4">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between text-left mb-3"
      >
        <h2 className="text-lg font-semibold text-white">Viewer Options</h2>
        <span className="text-gray-400">{isExpanded ? '▼' : '▶'}</span>
      </button>

      {isExpanded && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <label htmlFor="fixedAxes" className="text-sm text-gray-300">
              Fixed World Axes
            </label>
            <input
              id="fixedAxes"
              type="checkbox"
              checked={options.showFixedAxes}
              onChange={() => handleToggle('showFixedAxes')}
              className="w-4 h-4 text-blue-600 bg-gray-700 border-gray-600 rounded focus:ring-blue-500 focus:ring-2"
            />
          </div>

          <div className="flex items-center justify-between">
            <label htmlFor="movingAxes" className="text-sm text-gray-300">
              Moving Axes (Corner)
            </label>
            <input
              id="movingAxes"
              type="checkbox"
              checked={options.showMovingAxes}
              onChange={() => handleToggle('showMovingAxes')}
              className="w-4 h-4 text-blue-600 bg-gray-700 border-gray-600 rounded focus:ring-blue-500 focus:ring-2"
            />
          </div>
        </div>
      )}
    </div>
  );
}
