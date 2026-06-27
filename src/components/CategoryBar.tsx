/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { playBeep } from '../utils/beep.ts';

interface CategoryBarProps {
  activeCategory: string;
  setActiveCategory: (category: string) => void;
  onClearSearch: () => void;
  categoriesList: { id: string; label: string }[];
}

export const CategoryBar: React.FC<CategoryBarProps> = ({
  activeCategory,
  setActiveCategory,
  onClearSearch,
  categoriesList,
}) => {
  const handleCategoryClick = (catId: string) => {
    playBeep('select');
    setActiveCategory(catId);
    onClearSearch();
  };

  return (
    <nav 
      id="categoryBar" 
      className="bg-[#0f172a]/95 mx-5 my-2 px-5 py-2 rounded-full flex gap-2.5 overflow-x-auto whitespace-nowrap scrollbar-none border border-white/10"
    >
      {categoriesList.map((cat) => {
        const isActive = activeCategory === cat.id;
        return (
          <button
            key={cat.id}
            onClick={() => handleCategoryClick(cat.id)}
            className={`category-btn px-4.5 py-1.5 rounded-full font-semibold text-xs cursor-pointer transition-all shrink-0 outline-hidden focus-visible:outline-2 focus-visible:outline-white/40 focus-visible:outline-offset-2 ${
              isActive 
                ? 'bg-white text-slate-950 shadow-md ring-1 ring-white/50' 
                : 'bg-slate-950/40 text-slate-200 hover:bg-slate-900/50 border border-white/5'
            }`}
          >
            {cat.label}
          </button>
        );
      })}
    </nav>
  );
};
