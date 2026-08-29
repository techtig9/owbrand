'use client';

import { useEffect } from 'react';
import { initializePaddle } from '@paddle/paddle-js';

/** Mount once on the billing page so window.Paddle is ready before PlanGrid opens checkout. */
export function PaddleInit() {
  useEffect(() => {
    if (!process.env.NEXT_PUBLIC_PADDLE_CLIENT_TOKEN) return;
    initializePaddle({
      environment: process.env.NEXT_PUBLIC_PADDLE_ENV === 'production' ? 'production' : 'sandbox',
      token: process.env.NEXT_PUBLIC_PADDLE_CLIENT_TOKEN,
    }).then((paddleInstance) => {
      if (paddleInstance) (window as any).Paddle = paddleInstance;
    });
  }, []);

  return null;
}
