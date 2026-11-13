"use client";
import NextLink from 'next/link';
import {createContext,useContext,type ComponentProps} from 'react';
import {applicationPublicPath} from '../lib/application-routing';
export const ApplicationRoutingContext=createContext(false);
export function ApplicationLink({href,...props}:ComponentProps<typeof NextLink>){const clean=useContext(ApplicationRoutingContext);return <NextLink {...props} href={typeof href==='string'?applicationPublicPath(href,clean):href}/>;}
