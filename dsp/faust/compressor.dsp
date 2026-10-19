import("stdfaust.lib");
declare name "ToneScopeCompressor";
declare version "0.2.0";
// Controls are sample-rate signals, already smoothed by the host.
// State belongs to this graph. No previous/next-state ports are exposed.
onePole(a) = *(1.0-a) : + ~ *(a);
ballistics(target, sr, attack, release) = loop ~ _ with {
    loop(previous) = a*previous+(1.0-a)*target with {
        ms = select2(target>previous, release, attack);
        a = exp(-1.0/(ms*0.001*sr));
    };
};
compress(left, right, sr, threshold, ratio, attack, release, knee, makeup) = left*g, right*g, detector, reduction, g with {
    energy = left*left/2.0+right*right/2.0;
    detector = energy : onePole(exp(-1.0/(0.010*sr)));
    over = 10.0*log10(max(detector, 1e-30))-threshold;
    slope = 1.0-1.0/ratio;
    soft = slope*(over+knee/2.0)*(over+knee/2.0)/(2.0*max(knee,1e-30));
    target = select2((knee>0.0)&(over> -knee/2.0)&(over<knee/2.0), select2(over>=knee/2.0,0.0,slope*over),soft);
    reduction = ballistics(target, sr, attack, release);
    g = pow(10.0,(makeup-reduction)/20.0);
};
process = compress;
