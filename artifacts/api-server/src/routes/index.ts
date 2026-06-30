import { Router, type IRouter } from "express";
import healthRouter from "./health";
import reviewsRouter from "./reviews";

const router: IRouter = Router();

router.use(healthRouter);
router.use(reviewsRouter);

export default router;
