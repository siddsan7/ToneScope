declare name "ToneScopeCompressor";
declare version "0.1.0";
// Host supplies prior state and stores the two returned state values. This
// explicit recurrence supports linked stereo and independent multiband state.
step(energy, detector, reduction, sr, threshold, ratio, attack, release, knee, makeup) = g, d, r with {
    detectorA = exp(-1.0/(0.010*sr));
    d = detectorA*detector+(1.0-detectorA)*energy;
    over = 10.0*log10(max(d, 1e-30))-threshold;
    slope = 1.0-1.0/ratio;
    soft = slope*(over+knee/2.0)*(over+knee/2.0)/(2.0*max(knee,1e-30));
    target = select2((knee>0.0)&(over> -knee/2.0)&(over<knee/2.0), select2(over>=knee/2.0,0.0,slope*over),soft);
    ms = select2(target>reduction, release, attack);
    a = exp(-1.0/(ms*0.001*sr));
    r = a*reduction+(1.0-a)*target;
    g = pow(10.0,(makeup-r)/20.0);
};
process = step;
