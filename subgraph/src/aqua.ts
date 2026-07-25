import { Shipped, Docked, Pulled, Pushed } from "../generated/AquaRouter/Aqua"

export function handleShipped(event: Shipped): void {}
export function handleDocked(event: Docked): void {}
export function handlePulled(event: Pulled): void {}
export function handlePushed(event: Pushed): void {}
