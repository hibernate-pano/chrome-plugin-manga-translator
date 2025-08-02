import React from 'react';
import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/label';

interface StyleSliderProps {
  value: number;
  onChange: (value: number) => void;
}

const StyleSlider: React.FC<StyleSliderProps> = ({ value, onChange }) => {
  const handleValueChange = (values: number[]) => {
    onChange(values[0] ?? 0);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label htmlFor="style-slider">样式保持程度</Label>
        <span className="text-sm text-muted-foreground">{value}%</span>
      </div>
      <Slider
        id="style-slider"
        min={0}
        max={100}
        step={1}
        value={[value]}
        onValueChange={handleValueChange}
        className="w-full"
      />
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>更清晰</span>
        <span>更美观</span>
      </div>
    </div>
  );
};

export default StyleSlider;
