import React, { useState } from 'react';
import { ChevronRight, ShoppingCart, Tag, RotateCcw, BarChart3, Calendar, Users, Settings, LogOut, Menu, X } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface NavItem {
  id: string;
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  section?: 'main' | 'secondary';
}

interface Props {
  items: NavItem[];
  activeItem?: string;
}

const DEFAULT_ITEMS: NavItem[] = [
  {
    id: 'buy',
    label: 'Stock Intake',
    icon: <ShoppingCart size={20} />,
    onClick: () => {},
    section: 'main',
  },
  {
    id: 'sell',
    label: 'Sales',
    icon: <Tag size={20} />,
    onClick: () => {},
    section: 'main',
  },
  {
    id: 'returns',
    label: 'Returns',
    icon: <RotateCcw size={20} />,
    onClick: () => {},
    section: 'main',
  },
  {
    id: 'analytics',
    label: 'Analytics',
    icon: <BarChart3 size={20} />,
    onClick: () => {},
    section: 'secondary',
  },
  {
    id: 'calendar',
    label: 'Calendar',
    icon: <Calendar size={20} />,
    onClick: () => {},
    section: 'secondary',
  },
];

export default function CollapsibleNavMenu({ items = DEFAULT_ITEMS, activeItem }: Props) {
  const [isCollapsed, setIsCollapsed] = useState(true);

  return (
    <div className="flex h-full">
      {/* Main nav bar - always visible */}
      <div className="bg-gray-900 flex flex-col items-center py-4 w-20 border-r border-gray-800">
        {/* Toggle button */}
        <button
          onClick={() => setIsCollapsed(!isCollapsed)}
          className="p-3 hover:bg-gray-800 rounded-lg transition-all mb-4 text-gray-400 hover:text-white"
          title={isCollapsed ? 'Expand menu' : 'Collapse menu'}
        >
          {isCollapsed ? <Menu size={20} /> : <X size={20} />}
        </button>

        {/* Icon buttons */}
        <nav className="flex flex-col gap-2 flex-1">
          {items.map(item => (
            <button
              key={item.id}
              onClick={item.onClick}
              className={`p-3 rounded-lg transition-all ${
                activeItem === item.id
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800'
              }`}
              title={item.label}
            >
              {item.icon}
            </button>
          ))}
        </nav>

        {/* Settings and logout */}
        <div className="flex flex-col gap-2 mt-auto">
          <button className="p-3 text-gray-500 hover:text-gray-300 hover:bg-gray-800 rounded-lg transition-all" title="Settings">
            <Settings size={20} />
          </button>
          <button className="p-3 text-gray-500 hover:text-red-500 hover:bg-gray-800 rounded-lg transition-all" title="Sign out">
            <LogOut size={20} />
          </button>
        </div>
      </div>

      {/* Expandable sidebar */}
      <AnimatePresence>
        {!isCollapsed && (
          <motion.div
            initial={{ x: -280, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: -280, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="w-64 bg-gray-900 border-r border-gray-800 overflow-y-auto flex flex-col"
          >
            {/* Logo/Brand */}
            <div className="px-6 py-6 border-b border-gray-800">
              <h2 className="text-lg font-bold text-white font-display">INVENTORY</h2>
              <p className="text-xs text-gray-400 font-mono mt-1">Manager</p>
            </div>

            {/* Main navigation */}
            <nav className="flex-1 px-3 py-4">
              <div className="space-y-1">
                {items.filter(i => i.section === 'main').map(item => (
                  <button
                    key={item.id}
                    onClick={item.onClick}
                    className={`w-full flex items-center justify-between px-4 py-3 rounded-lg transition-all ${
                      activeItem === item.id
                        ? 'bg-blue-600 text-white'
                        : 'text-gray-300 hover:bg-gray-800'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-gray-400">{item.icon}</span>
                      <span className="font-medium">{item.label}</span>
                    </div>
                    <ChevronRight size={16} className="opacity-50" />
                  </button>
                ))}
              </div>

              {/* Secondary navigation */}
              <div className="mt-8 pt-8 border-t border-gray-800">
                <p className="px-4 text-xs font-mono text-gray-500 uppercase tracking-widest mb-3">Analytics</p>
                <div className="space-y-1">
                  {items.filter(i => i.section === 'secondary').map(item => (
                    <button
                      key={item.id}
                      onClick={item.onClick}
                      className={`w-full flex items-center justify-between px-4 py-3 rounded-lg transition-all ${
                        activeItem === item.id
                          ? 'bg-blue-600 text-white'
                          : 'text-gray-400 hover:bg-gray-800'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <span className="text-gray-500">{item.icon}</span>
                        <span className="text-sm">{item.label}</span>
                      </div>
                      <ChevronRight size={16} className="opacity-50" />
                    </button>
                  ))}
                </div>
              </div>
            </nav>

            {/* User section */}
            <div className="px-4 py-4 border-t border-gray-800">
              <button className="w-full flex items-center gap-3 px-4 py-3 rounded-lg text-gray-300 hover:bg-gray-800 transition-all text-sm">
                <Settings size={18} />
                <span>Settings</span>
              </button>
              <button className="w-full flex items-center gap-3 px-4 py-3 rounded-lg text-gray-400 hover:bg-red-900/20 hover:text-red-400 transition-all text-sm mt-1">
                <LogOut size={18} />
                <span>Sign Out</span>
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
