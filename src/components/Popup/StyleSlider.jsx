import React from 'react';

const StyleSlider = ({ value, onChange }) => {
  const handleChange = (e) => {
    onChange(Number(e.target.value));
  };

  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">
        样式保持程度: {value}%
      </label>
      <input
        type="range"
        min="0"
        max="100"
        value={value}
        onChange={handleChange}
        className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
      />
      <div className="flex justify-between text-xs text-gray-500 mt-1">
        <span>更清晰</span>
        <span>更美观</span>
      </div>
    </div>
  );
};

export default StyleSlider;
