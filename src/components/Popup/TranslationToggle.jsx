// import React from 'react';

const TranslationToggle = ({ enabled, onChange }) => {
  const handleChange = () => {
    onChange(!enabled);
  };

  return (
    <div className="flex items-center justify-between">
      <span className="text-sm font-medium text-gray-700">启用翻译</span>
      <button
        onClick={handleChange}
        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${
          enabled ? 'bg-blue-600' : 'bg-gray-200'
        }`}
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
            enabled ? 'translate-x-6' : 'translate-x-1'
          }`}
        />
      </button>
    </div>
  );
};

export default TranslationToggle;
