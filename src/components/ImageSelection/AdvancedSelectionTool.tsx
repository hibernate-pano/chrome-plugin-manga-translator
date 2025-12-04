import React, { useState, useRef, useEffect } from 'react';
import { PenTool, Eraser, Eye, EyeOff, Check, X, RotateCcw, ZoomIn, ZoomOut, Square, Triangle } from 'lucide-react';

// 选区类型枚举
export type SelectionType = 'rectangle' | 'polygon';

// 点坐标接口
interface Point {
  x: number;
  y: number;
}

// 选区接口
interface Selection {
  id: string;
  type: SelectionType;
  points: Point[];
  text: string;
  confidence: number;
}

// 组件属性接口
interface AdvancedSelectionToolProps {
  imageSrc: string;
  initialSelections?: Selection[];
  onSelectionsChange: (selections: Selection[]) => void;
  onComplete: (selections: Selection[]) => void;
  onCancel: () => void;
}

// 增强的图像选区工具组件
export const AdvancedSelectionTool: React.FC<AdvancedSelectionToolProps> = ({
  imageSrc,
  initialSelections = [],
  onSelectionsChange,
  onComplete,
  onCancel,
}) => {
  // 状态管理
  const [selections, setSelections] = useState<Selection[]>(initialSelections);
  const [activeSelection, setActiveSelection] = useState<string | null>(null);
  const [selectionType, setSelectionType] = useState<SelectionType>('rectangle');
  const [isDrawing, setIsDrawing] = useState(false);
  const [currentPoints, setCurrentPoints] = useState<Point[]>([]);
  const [zoom, setZoom] = useState(1);
  const [showGrid, setShowGrid] = useState(false);
  const [showSelections, setShowSelections] = useState(true);
  
  // 引用
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragStartRef = useRef<Point | null>(null);
  const resizeHandleRef = useRef<string | null>(null);
  
  // 初始化图像
  useEffect(() => {
    if (imageRef.current) {
      imageRef.current.onload = () => {
        drawCanvas();
      };
      imageRef.current.src = imageSrc;
    }
  }, [imageSrc, selections, currentPoints, isDrawing, zoom, showGrid, showSelections]);
  
  // 绘制画布
  const drawCanvas = () => {
    const canvas = canvasRef.current;
    const image = imageRef.current;
    if (!canvas || !image) return;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    // 清除画布
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // 绘制图像
    ctx.save();
    ctx.scale(zoom, zoom);
    ctx.drawImage(image, 0, 0);
    ctx.restore();
    
    // 绘制网格（如果启用）
    if (showGrid) {
      drawGrid(ctx);
    }
    
    // 绘制现有选区
    if (showSelections) {
      selections.forEach(selection => {
        drawSelection(ctx, selection, selection.id === activeSelection);
      });
    }
    
    // 绘制正在绘制的选区
    if (isDrawing && currentPoints.length > 0) {
      drawSelection(ctx, {
        id: 'temp',
        type: selectionType,
        points: currentPoints,
        text: '',
        confidence: 0,
      }, true);
    }
  };
  
  // 绘制网格
  const drawGrid = (ctx: CanvasRenderingContext2D) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.1)';
    ctx.lineWidth = 1;
    
    // 垂直线
    for (let x = 0; x <= canvas.width; x += 50 * zoom) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, canvas.height);
      ctx.stroke();
    }
    
    // 水平线
    for (let y = 0; y <= canvas.height; y += 50 * zoom) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(canvas.width, y);
      ctx.stroke();
    }
  };
  
  // 绘制选区
  const drawSelection = (ctx: CanvasRenderingContext2D, selection: Selection, isActive: boolean) => {
    if (selection.points.length < 2) return;
    
    ctx.save();
    ctx.strokeStyle = isActive ? '#ff0000' : '#00ff00';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.lineWidth = 2 * zoom;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    
    // 绘制选区形状
    ctx.beginPath();
    const firstPoint = selection.points[0];
    if (firstPoint) {
      ctx.moveTo(firstPoint.x * zoom, firstPoint.y * zoom);
      
      for (let i = 1; i < selection.points.length; i++) {
        const point = selection.points[i];
        if (point) {
          ctx.lineTo(point.x * zoom, point.y * zoom);
        }
      }
      
      // 闭合路径
      if (selection.type === 'polygon' || selection.points.length >= 4) {
        ctx.closePath();
        ctx.fill();
      }
      
      ctx.stroke();
      
      // 绘制控制点
      selection.points.forEach((point, index) => {
        if (point) {
          ctx.fillStyle = isActive ? '#ff0000' : '#00ff00';
          ctx.beginPath();
          ctx.arc(point.x * zoom, point.y * zoom, 5 * zoom, 0, Math.PI * 2);
          ctx.fill();
          
          // 绘制控制点索引
          ctx.fillStyle = '#ffffff';
          ctx.font = `${12 * zoom}px Arial`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(index.toString(), point.x * zoom, point.y * zoom);
        }
      });
    }
    
    ctx.restore();
  };
  
  // 处理鼠标按下事件
  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / zoom;
    const y = (e.clientY - rect.top) / zoom;
    
    // 检查是否点击了现有选区
    const clickedSelection = selections.find(selection => {
      // 简单的点击检测，实际项目中应该使用更精确的算法
      return selection.points.some(point => {
        const distance = Math.sqrt(Math.pow(point.x - x, 2) + Math.pow(point.y - y, 2));
        return distance < 10; // 10px点击半径
      });
    });
    
    if (clickedSelection) {
      // 激活现有选区
      setActiveSelection(clickedSelection.id);
      dragStartRef.current = { x, y };
    } else {
      // 开始新的选区
      setIsDrawing(true);
      setCurrentPoints([{ x, y }]);
    }
  };
  
  // 处理鼠标移动事件
  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawing && !dragStartRef.current) return;
    
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / zoom;
    const y = (e.clientY - rect.top) / zoom;
    
    if (isDrawing) {
      // 正在绘制新选区
      if (selectionType === 'rectangle') {
        // 矩形选区：只需要两个点
        const startPoint = currentPoints[0];
        if (startPoint) {
          setCurrentPoints([
            startPoint,
            { x: x, y: startPoint.y },
            { x, y },
            { x: startPoint.x, y },
          ]);
        }
      } else {
        // 多边形选区：添加多个点
        setCurrentPoints([...currentPoints, { x, y }]);
      }
    } else if (dragStartRef.current && activeSelection) {
      // 拖动现有选区
      const dx = x - dragStartRef.current.x;
      const dy = y - dragStartRef.current.y;
      
      const updatedSelections = selections.map(selection => {
        if (selection.id === activeSelection) {
          return {
            ...selection,
            points: selection.points.map(point => ({
              x: point.x + dx,
              y: point.y + dy,
            })),
          };
        }
        return selection;
      });
      
      setSelections(updatedSelections);
      onSelectionsChange(updatedSelections);
      dragStartRef.current = { x, y };
    }
  };
  
  // 处理鼠标抬起事件
  const handleMouseUp = () => {
    if (isDrawing) {
      // 完成绘制
      if (currentPoints.length >= 2) {
        const newSelection: Selection = {
          id: `selection-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          type: selectionType,
          points: currentPoints,
          text: '',
          confidence: 0.8,
        };
        
        const updatedSelections = [...selections, newSelection];
        setSelections(updatedSelections);
        setActiveSelection(newSelection.id);
        onSelectionsChange(updatedSelections);
      }
      
      setIsDrawing(false);
      setCurrentPoints([]);
    }
    
    dragStartRef.current = null;
  };
  
  // 处理键盘事件
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // 删除键：删除选中的选区
      if (e.key === 'Delete' && activeSelection) {
        const updatedSelections = selections.filter(selection => selection.id !== activeSelection);
        setSelections(updatedSelections);
        setActiveSelection(null);
        onSelectionsChange(updatedSelections);
      }
      
      // Escape键：取消当前操作
      if (e.key === 'Escape') {
        if (isDrawing) {
          setIsDrawing(false);
          setCurrentPoints([]);
        } else {
          onCancel();
        }
      }
      
      // Enter键：完成选区
      if (e.key === 'Enter' && currentPoints.length >= 2) {
        handleMouseUp();
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selections, activeSelection, isDrawing, currentPoints, onSelectionsChange, onCancel]);
  
  // 处理缩放
  const handleZoom = (delta: number) => {
    setZoom(prev => Math.max(0.1, Math.min(5, prev + delta)));
  };
  
  // 重置视图
  const resetView = () => {
    setZoom(1);
    setSelectionType('rectangle');
    setShowGrid(false);
    setShowSelections(true);
  };
  
  // 清除所有选区
  const clearAll = () => {
    if (confirm('确定要清除所有选区吗？')) {
      setSelections([]);
      setActiveSelection(null);
      onSelectionsChange([]);
    }
  };
  
  // 完成选择
  const handleComplete = () => {
    onComplete(selections);
  };
  
  return (
    <div className="advanced-selection-tool w-full h-screen flex flex-col bg-gray-900">
      {/* 顶部工具栏 */}
      <div className="toolbar p-3 bg-gray-800 border-b border-gray-700 flex flex-wrap gap-2 items-center justify-between">
        <div className="flex items-center gap-2">
          {/* 选择类型切换 */}
          <div className="flex gap-1">
            <button
              onClick={() => setSelectionType('rectangle')}
              className={`p-2 rounded ${selectionType === 'rectangle' ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}
              title="矩形选区"
            >
              <Square size={20} />
            </button>
            <button
              onClick={() => setSelectionType('polygon')}
              className={`p-2 rounded ${selectionType === 'polygon' ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}
              title="多边形选区"
            >
              <Triangle size={20} />
            </button>
          </div>
          
          <div className="border-l border-gray-700 h-8"></div>
          
          {/* 查看选项 */}
          <button
            onClick={() => setShowSelections(!showSelections)}
            className="p-2 rounded bg-gray-700 text-gray-300 hover:bg-gray-600"
            title={showSelections ? '隐藏选区' : '显示选区'}
          >
            {showSelections ? <Eye size={20} /> : <EyeOff size={20} />}
          </button>
          
          <button
            onClick={() => setShowGrid(!showGrid)}
            className="p-2 rounded bg-gray-700 text-gray-300 hover:bg-gray-600"
            title={showGrid ? '隐藏网格' : '显示网格'}
          >
            <PenTool size={20} />
          </button>
          
          <div className="border-l border-gray-700 h-8"></div>
          
          {/* 缩放控制 */}
          <div className="flex items-center gap-1">
            <button
              onClick={() => handleZoom(-0.1)}
              className="p-2 rounded bg-gray-700 text-gray-300 hover:bg-gray-600"
              title="缩小"
            >
              <ZoomOut size={20} />
            </button>
            <span className="text-white font-mono">{Math.round(zoom * 100)}%</span>
            <button
              onClick={() => handleZoom(0.1)}
              className="p-2 rounded bg-gray-700 text-gray-300 hover:bg-gray-600"
              title="放大"
            >
              <ZoomIn size={20} />
            </button>
          </div>
          
          <button
            onClick={resetView}
            className="p-2 rounded bg-gray-700 text-gray-300 hover:bg-gray-600"
            title="重置视图"
          >
            <RotateCcw size={20} />
          </button>
        </div>
        
        <div className="flex items-center gap-2">
          {/* 状态信息 */}
          <div className="text-white text-sm">
            选区: {selections.length}
            {activeSelection && ` | 选中: ${activeSelection}`}
          </div>
          
          {/* 操作按钮 */}
          <button
            onClick={clearAll}
            className="px-3 py-2 bg-red-600 hover:bg-red-700 text-white rounded flex items-center gap-1"
            title="清除所有选区"
          >
            <X size={16} />
            <span>清除</span>
          </button>
          
          <button
            onClick={onCancel}
            className="px-3 py-2 bg-gray-600 hover:bg-gray-700 text-white rounded flex items-center gap-1"
            title="取消"
          >
            <X size={16} />
            <span>取消</span>
          </button>
          
          <button
            onClick={handleComplete}
            className="px-3 py-2 bg-green-600 hover:bg-green-700 text-white rounded flex items-center gap-1"
            title="完成"
          >
            <Check size={16} />
            <span>完成</span>
          </button>
        </div>
      </div>
      
      {/* 主画布区域 */}
      <div 
        ref={containerRef} 
        className="flex-1 overflow-auto relative bg-gray-950"
        style={{ cursor: isDrawing ? 'crosshair' : 'default' }}
      >
        {/* 隐藏的图像元素，用于加载图像 */}
        <img
          ref={imageRef}
          src={imageSrc}
          alt="Selection target"
          className="hidden"
          crossOrigin="anonymous"
        />
        
        {/* 画布 */}
        <canvas
          ref={canvasRef}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2"
        />
        
        {/* 辅助网格（可选） */}
        {showGrid && (
          <div className="absolute inset-0 pointer-events-none">
            {/* 网格背景 */}
            <div
              style={{
                backgroundImage: `linear-gradient(rgba(255, 255, 255, 0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255, 255, 255, 0.1) 1px, transparent 1px)`,
                backgroundSize: `${50 * zoom}px ${50 * zoom}px`,
              }}
              className="absolute inset-0"
            />
          </div>
        )}
      </div>
      
      {/* 底部状态栏 */}
      <div className="status-bar p-2 bg-gray-800 border-t border-gray-700 text-white text-sm flex justify-between">
        <div>
          <span className="font-medium">当前模式:</span> 
          {selectionType === 'rectangle' ? '矩形选区' : '多边形选区'}
          {isDrawing && ` | 绘制中...`}
        </div>
        <div>
          <span className="font-medium">提示:</span> 
          {selectionType === 'rectangle' 
            ? '点击并拖动绘制矩形，按Delete删除选中选区' 
            : '点击多个点绘制多边形，按Enter完成，按Delete删除选中选区'}
        </div>
      </div>
    </div>
  );
};
