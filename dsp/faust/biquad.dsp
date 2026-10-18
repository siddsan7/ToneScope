declare name "ToneScopeBiquad";
declare version "0.1.0";
// Transposed direct-form II. Host supplies RBJ coefficients and owns fixed
// stereo histories. All filtering and state evolution are generated from here.
step(x,z1,z2,b0,b1,b2,a1,a2) = y, next1, next2 with {
    y = b0*x+z1;
    next1 = b1*x-a1*y+z2;
    next2 = b2*x-a2*y;
};
process = step;
