import { createContext, useContext } from 'react';

export const GameContext = createContext({ screens: [], assets: {} });

export function useGameContext() {
  return useContext(GameContext);
}
