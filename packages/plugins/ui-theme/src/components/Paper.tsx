import { default as MaterialUIPaper, PaperProps } from '@mui/material/Paper';
import React, { forwardRef } from 'react';

type PaperRef = HTMLElementTagNameMap[keyof HTMLElementTagNameMap];

const Paper = forwardRef<PaperRef, PaperProps>(function Paper(props, ref) {
  return <MaterialUIPaper {...props} ref={ref} />;
});

export default Paper;
